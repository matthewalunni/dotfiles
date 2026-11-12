// Shared stub body: prints the view name and three token swatches.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme } from "herdr";
import { deckTokens } from "../lib/tokens.js";

export function stub(name) {
  const k = deckTokens(theme());
  const swatch = (label, color) =>
    h_flex().items_center().gap(6).child(div().w(14).h(14).rounded(3).border_1().border_color(k.line).bg(color)).child(div().text_size(11).text_color(k.muted).child(`${label} ${color}`));
  return v_flex()
    .size_full()
    .bg(k.chrome)
    .p(10)
    .gap(4)
    .child(div().text_size(13).font_semibold().text_color(k.strong).child(`deck: ${name}`))
    .child(h_flex().gap(14).child(swatch("hold", k.hold)).child(swatch("holdBg", k.holdBg)).child(swatch("brand", k.brand)));
}
