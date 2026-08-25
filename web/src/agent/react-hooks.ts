import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { ChatActions, ChatRuntime, Selector } from "./runtime/types.ts";

const ChatRuntimeContext = createContext<ChatRuntime | undefined>(undefined);

export const ChatProvider = ({
  runtime,
  children,
}: {
  readonly runtime: ChatRuntime;
  readonly children?: ReactNode;
}) => {
  const runtimeGeneration = useRef(0);
  const activeRuntime = useRef<ChatRuntime | undefined>(undefined);
  useEffect(() => {
    runtimeGeneration.current += 1;
    const generation = runtimeGeneration.current;
    activeRuntime.current = runtime;
    runtime.start();
    return () => {
      queueMicrotask(() => {
        if (runtimeGeneration.current === generation || activeRuntime.current !== runtime)
          runtime.dispose();
      });
    };
  }, [runtime]);
  return createElement(ChatRuntimeContext.Provider, { value: runtime }, children);
};

export const useChatRuntime = (): ChatRuntime => {
  const runtime = useContext(ChatRuntimeContext);
  if (runtime === undefined) throw new Error("useChatRuntime must be used inside ChatProvider.");
  return runtime;
};

export const useChatSelector = <Value>(selector: Selector<Value>): Value => {
  const runtime = useChatRuntime();
  return selector(useSyncExternalStore(runtime.subscribe, runtime.getState, runtime.getState));
};

export const useChatActions = (): ChatActions => useChatRuntime().actions;
