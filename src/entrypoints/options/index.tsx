import { render } from "preact";
import { OptionsApp } from "../../components/options/OptionsApp";

const container = document.getElementById("app");
if (container) {
  render(<OptionsApp />, container);
}
