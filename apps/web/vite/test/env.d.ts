// `?nocopy` imports load a fixture without the live-text transform (render-equality tests).
declare module '*?nocopy' {
  type Component = (props: Record<string, unknown>) => unknown;
  export const Rich: Component;
  export const Arrow: Component;
  export const askLeave: (crew: { name: string }) => unknown;
}
