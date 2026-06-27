"use client";

import { useSyncExternalStore } from "react";
import { formatLocalTime } from "@/lib/utils";

// 用于检测客户端挂载状态的外部存储
const emptySubscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * Hook: 检测是否已在客户端挂载
 * 使用 useSyncExternalStore 避免 useEffect + setState 的 lint 警告
 */
function useIsMounted() {
  return useSyncExternalStore(emptySubscribe, getClientSnapshot, getServerSnapshot);
}

interface ClientTimeProps {
  /** 要格式化的时间值 */
  value: string | number | Date;
  /** 挂载前显示的占位符，默认为空 */
  placeholder?: string;
  /** 自定义 className */
  className?: string;
}

/**
 * 客户端时间组件
 * 解决 SSR 水合问题：服务端和客户端时区不一致导致的渲染差异
 * 仅在客户端挂载后才渲染格式化的本地时间
 */
export function ClientTime({ value, placeholder = "", className }: ClientTimeProps) {
  const isMounted = useIsMounted();

  if (!isMounted) {
    return placeholder ? <span className={className}>{placeholder}</span> : null;
  }

  return <span className={className}>{formatLocalTime(value)}</span>;
}

interface ClientYearProps {
  /** 挂载前显示的占位符 */
  placeholder?: string;
}

/**
 * 客户端年份组件
 * 避免服务端和客户端在年末年初时可能的年份差异
 */
export function ClientYear({ placeholder = "" }: ClientYearProps) {
  const isMounted = useIsMounted();

  if (!isMounted) {
    return <>{placeholder}</>;
  }

  return <>{new Date().getFullYear()}</>;
}
