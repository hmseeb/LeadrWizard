/// <reference types="vite/client" />

// CSS imported with `?inline` returns the raw CSS string so we can inject
// it into the widget's shadow DOM at runtime.
declare module "*.css?inline" {
  const content: string;
  export default content;
}
