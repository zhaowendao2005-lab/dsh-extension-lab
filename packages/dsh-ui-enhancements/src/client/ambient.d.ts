export {}

declare global {
  interface Window {
    __ModuleLoader__?: {
      load(spec: { id: string; factory(require: (specifier: string) => any): unknown }): void
    }
  }
}

declare module '*.css' {
  const content: string
  export default content
}
