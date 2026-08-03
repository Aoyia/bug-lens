import { render } from "preact";
import { PopupApp } from "../../components/popup/PopupApp";

const container = document.getElementById("app");
if (container) {
  render(<PopupApp />, container);
}
