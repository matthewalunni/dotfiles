// Shows images stacked in a scrolling column, each under its file name.
// Props: { images: ["mods/image-viewer/shots/x.png", ...] }. GPUI resolves image paths
// against ~/.config/herdr-app, so herdr-show-images copies files into shots/ first.
import { View, div, image } from "gpui-kit";
import { v_flex } from "gpui-base";
import { theme, props } from "herdr";

export default class ImageViewer extends View {
  init(_props, _cx) {}

  render(_cx) {
    const t = theme();
    const images = props()?.images ?? [];
    return v_flex()
      .id("image-viewer")
      .size_full()
      .min_h(0)
      .bg(t.background)
      .text_color(t.foreground)
      .text_size(13)
      .overflow_y_scrollbar()
      .p(10)
      .gap(14)
      .when(images.length === 0, (el) => el.child(div().text_color(t.muted).child("No images. Run herdr-show-images <file>...")))
      .children(
        images.map((p, i) =>
          v_flex()
            .id(`img-${i}`)
            .gap(6)
            .child(div().text_color(t.muted).child(p.split("/").pop().replace(/^\d+-/, "")))
            .child(image(p).w_full().h(420))
        )
      );
  }
}
