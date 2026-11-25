"""Tests for dot_local/bin/executable_obs-ctl. Run: python3 tests/obs-ctl.test.py"""

import contextlib
import importlib.machinery
import importlib.util
import json
import os
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True  # keep __pycache__ out of dot_local/bin
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "dot_local", "bin", "executable_obs-ctl")
loader = importlib.machinery.SourceFileLoader("obs_ctl", SRC)
spec = importlib.util.spec_from_loader("obs_ctl", loader)
obs_ctl = importlib.util.module_from_spec(spec)
loader.exec_module(obs_ctl)


class FakeOBS:
    def __init__(self):
        self.recording = False
        self.paused = False
        self.record_dir = "/orig"
        self.scenes = ["Scene", "Agent Coding"]
        self.scene = "Scene"
        self.calls = []

    def call(self, rtype, data=None):
        self.calls.append(rtype)
        E = obs_ctl.OBSError
        if rtype == "GetRecordStatus":
            return {"outputActive": self.recording, "outputPaused": self.paused}
        if rtype == "GetSceneList":
            return {"scenes": [{"sceneName": s} for s in self.scenes]}
        if rtype == "SetCurrentProgramScene":
            self.scene = data["sceneName"]
            return {}
        if rtype == "GetRecordDirectory":
            return {"recordDirectory": self.record_dir}
        if rtype == "SetRecordDirectory":
            self.record_dir = data["recordDirectory"]
            return {}
        if rtype == "StartRecord":
            self.recording = True
            return {}
        if rtype == "StopRecord":
            if not self.recording:
                raise E("not running", obs_ctl.OUTPUT_NOT_RUNNING)
            self.recording = self.paused = False
            return {"outputPath": os.path.join(self.record_dir, "clip.mkv")}
        if rtype == "PauseRecord":
            if not self.recording:
                raise E("not running", obs_ctl.OUTPUT_NOT_RUNNING)
            if self.paused:
                raise E("paused", obs_ctl.OUTPUT_PAUSED)
            self.paused = True
            return {}
        if rtype == "ResumeRecord":
            if not self.recording:
                raise E("not running", obs_ctl.OUTPUT_NOT_RUNNING)
            if not self.paused:
                raise E("not paused", obs_ctl.OUTPUT_NOT_PAUSED)
            self.paused = False
            return {}
        raise AssertionError("unexpected request " + rtype)


class ObsCtlTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = self.tmp.name
        obs_ctl.STATE_DIR = os.path.join(d, "state")
        obs_ctl.STATE_FILE = os.path.join(d, "state", "active.json")
        obs_ctl.LOCK_FILE = os.path.join(d, "state", "lock")
        obs_ctl.LOG_FILE = os.path.join(d, "state", "hook.log")
        self.out = os.path.join(d, "footage")
        self.obs = FakeOBS()
        self.cfg = {"dir": self.out}

    def tearDown(self):
        self.tmp.cleanup()

    def connect(self):
        return contextlib.nullcontext(self.obs)

    def hook(self, name, session="s1", **extra):
        event = dict(hook_event_name=name, session_id=session, **extra)
        return obs_ctl.run_hook(event, connect_fn=self.connect)

    def start(self, **kw):
        return obs_ctl.do_start(self.obs, self.cfg, **kw)

    def claim(self, session="s1"):
        return self.hook("PostToolUse", session=session, tool_name="Bash",
                         tool_input={"command": "obs-ctl start --scene 'Agent Coding'"})

    def test_hooks_do_nothing_without_a_recording(self):
        self.assertIsNone(self.hook("Stop"))
        self.assertEqual(self.obs.calls, [])

    def test_start_sets_scene_and_folder_then_stop_restores(self):
        state, warnings = self.start(scene="Agent Coding", title="t")
        self.assertEqual(warnings, [])
        self.assertEqual(self.obs.scene, "Agent Coding")
        self.assertEqual(self.obs.record_dir, self.out)
        self.assertTrue(self.obs.recording)
        path = obs_ctl.do_stop(self.obs, obs_ctl.read_state())
        self.assertEqual(self.obs.record_dir, "/orig")
        self.assertIsNone(obs_ctl.read_state())
        with open(os.path.join(self.out, "clip.json")) as f:
            meta = json.load(f)
        self.assertEqual(meta["title"], "t")
        self.assertEqual(meta["file"], path)

    def test_unknown_scene_warns_and_keeps_recording(self):
        state, warnings = self.start(scene="Nope")
        self.assertEqual(len(warnings), 1)
        self.assertIsNone(state["scene"])
        self.assertTrue(self.obs.recording)

    def test_refuses_to_start_twice(self):
        self.start()
        with self.assertRaises(obs_ctl.OBSError):
            self.start()

    def test_starting_session_claims_and_others_are_ignored(self):
        self.start()
        self.assertIsNone(self.hook("Stop", session="s1"))  # not claimed yet
        self.assertIsNone(self.hook("PostToolUse", session="s2", tool_name="Bash",
                                    tool_input={"command": "ls"}))
        self.assertEqual(self.claim("s1"), "claimed")
        self.assertIsNone(self.hook("Stop", session="s2"))
        self.assertFalse(self.obs.paused)

    def test_only_an_obs_ctl_start_command_claims(self):
        self.start()
        for cmd in ("grep obs-ctl README.md && echo start", "obs-ctl status", "cat start.txt"):
            self.assertIsNone(self.hook("PostToolUse", session="s2", tool_name="Bash",
                                        tool_input={"command": cmd}), cmd)
        self.assertEqual(self.hook("PostToolUse", session="s1", tool_name="Bash",
                                   tool_input={"command": "~/.local/bin/obs-ctl start --title x"}),
                         "claimed")

    def test_waiting_pauses_and_working_resumes(self):
        self.start()
        self.claim()
        self.assertEqual(self.hook("Stop"), "pause")
        self.assertTrue(self.obs.paused)
        self.assertIsNone(self.hook("Notification"))  # already paused, no OBS call
        self.assertEqual(self.hook("UserPromptSubmit"), "resume")
        self.assertFalse(self.obs.paused)
        self.assertIsNone(self.hook("PreToolUse", tool_name="Bash"))
        self.assertEqual(self.hook("PermissionRequest", tool_name="Bash"), "pause")
        self.assertEqual(self.hook("PostToolUse", tool_name="Bash"), "resume")
        state = obs_ctl.read_state()
        self.assertEqual(len(state["pauses"]), 2)
        self.assertTrue(all("end" in p for p in state["pauses"]))

    def test_ask_user_question_pauses_until_answered(self):
        self.start()
        self.claim()
        self.assertEqual(self.hook("PreToolUse", tool_name="AskUserQuestion"), "pause")
        self.assertEqual(self.hook("PostToolUse", tool_name="AskUserQuestion"), "resume")

    def test_held_pause_survives_hooks(self):
        self.start()
        self.claim()
        state = obs_ctl.read_state()
        obs_ctl.set_paused(self.obs, state, True, "manual", hold=True)
        self.assertIsNone(self.hook("PreToolUse", tool_name="Bash"))
        self.assertIsNone(self.hook("UserPromptSubmit"))
        self.assertTrue(self.obs.paused)
        obs_ctl.set_paused(self.obs, obs_ctl.read_state(), False, "manual")
        self.assertFalse(self.obs.paused)
        self.assertFalse(obs_ctl.read_state()["held"])

    def test_session_end_stops(self):
        self.start()
        self.claim()
        self.hook("Stop")
        self.assertEqual(self.hook("SessionEnd"), "stop")
        self.assertFalse(self.obs.recording)
        self.assertIsNone(obs_ctl.read_state())

    def test_stopped_by_hand_in_obs_clears_state(self):
        self.start()
        self.claim()
        self.obs.recording = False
        self.assertEqual(self.hook("Stop"), "cleared")
        self.assertIsNone(obs_ctl.read_state())

    def test_obs_unreachable_never_raises(self):
        self.start()
        self.claim()

        def broken():
            raise obs_ctl.OBSError("can't reach OBS")
        event = {"hook_event_name": "Stop", "session_id": "s1"}
        self.assertEqual(obs_ctl.run_hook(event, connect_fn=broken), "error")
        with open(obs_ctl.LOG_FILE) as f:
            self.assertIn("can't reach OBS", f.read())


if __name__ == "__main__":
    unittest.main(verbosity=1 if "-q" in sys.argv else 2, argv=[sys.argv[0]])
