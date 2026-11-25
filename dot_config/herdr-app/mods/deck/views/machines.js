// Terminal view sidebar block: other machines from `hc machine ls` (data.js
// polls it into MACHINES_KEY) and "+ Add machine", which opens Herdr's picker.
// Styled like the shipped spaces/agents sidebar blocks it sits between.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { shared, run, spaces } from "herdr";
import { MACHINES_KEY } from "../data.js";
import { tokens } from "./ui.js";

/** @returns {{name: string, online: boolean, agents: number}[]} */
function machineList() {
  const m = shared(MACHINES_KEY);
  return Array.isArray(m) ? m.filter((x) => x && typeof x.name === "string" && x.name) : [];
}

const addMachine = () => run("mod.open", { name: "machine-add" });

/** Show the machine's first space, or start one there (in its home) when it has none. */
function openMachine(name) {
  const sp = spaces().find((s) => s.machine === name);
  if (sp) run("space.select", { id: sp.id });
  else run("space.new", { machine: name });
}

export default class MachinesView extends View {
  init() {}

  /** The dashed "+ Add machine" row; with `note`, a second muted line. */
  addRow(note) {
    const k = tokens();
    return h_flex()
      .id("machines-add")
      .flex_none()
      .mx(8)
      .px(10)
      .py(note ? 8 : 6)
      .gap(8)
      .items_center()
      .rounded(8)
      .cursor_pointer()
      .hover((s) => s.bg(k.wash))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        addMachine();
      })
      .child(div().flex_none().text_size(14).text_color(k.brand).child("+"))
      .child(
        v_flex()
          .min_w(0)
          .child(div().text_size(12.5).text_color(k.strong).child("Add machine"))
          .when(Boolean(note), (el) => el.child(div().text_size(11).text_color(k.muted).truncate().child(note))),
      );
  }

  render() {
    const k = tokens();
    const list = machineList();
    const root = v_flex().size_full().min_h(0).bg(k.chrome).text_size(13);

    if (!list.length) {
      return root.justify_center().child(this.addRow("run agents on another Mac"));
    }

    const rows = list.map((m, i) =>
      h_flex()
        .id("machine-" + i)
        .flex_none()
        .h(26)
        .px(8)
        .gap(8)
        .items_center()
        .rounded(6)
        .when(m.online, (el) =>
          el
            .cursor_pointer()
            .hover((s) => s.bg(k.wash))
            .on_click((_e, cx) => {
              cx.stop_propagation();
              openMachine(m.name);
            }),
        )
        .child(
          m.online
            ? div().flex_none().w(8).h(8).rounded(8).bg(k.ok)
            : div().flex_none().w(8).h(8).rounded(8).border_1().border_color(k.muted),
        )
        .child(div().flex_1().min_w(0).truncate().text_color(m.online ? k.strong : k.muted).child(m.name))
        .child(div().flex_none().text_size(11).text_color(k.muted).child(m.online ? String(m.agents) : "offline")),
    );

    return root
      .child(
        h_flex()
          .flex_none()
          .px(16)
          .pt(10)
          .pb(4)
          .child(div().text_size(11.5).font_medium().text_color(k.muted).child("Machines")),
      )
      .child(
        v_flex()
          .id("machines-list")
          .flex_1()
          .min_h(0)
          .pb(8)
          .gap(4)
          .overflow_y_scrollbar()
          .child(v_flex().px(8).children(rows))
          .child(this.addRow(null)),
      );
  }
}
