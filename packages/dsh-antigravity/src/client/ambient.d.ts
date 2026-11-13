interface DshModuleLoader {
  load(spec: {
    id: string;
    factory(require: (id: string) => any): {
      name: string;
      inject?: readonly string[];
      apply(ctx: any): void | Promise<void>;
    };
  }): void;
}

interface Window {
  __ModuleLoader__?: DshModuleLoader;
}
