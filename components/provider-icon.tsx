"use client";

import {Anthropic, Gemini, OpenAI} from "@lobehub/icons";

import type {ProviderType} from "@/lib/types";
import {cn} from "@/lib/utils";

const ICON_MAP: Record<
  ProviderType,
  React.ComponentType<{ className?: string; size?: number }>
> = {
  openai: OpenAI,
  gemini: Gemini,
  anthropic: Anthropic,
};

interface ProviderIconProps {
  type: ProviderType;
  className?: string;
  size?: number;
}

/** 按 Provider 类型渲染统一风格的图标，避免在业务组件中关心具体 icon 实现 */
export function ProviderIcon({ type, className, size = 18 }: ProviderIconProps) {
  const Icon = ICON_MAP[type];
  if (!Icon) return null;
  return <Icon className={cn("shrink-0", className)} size={size} />;
}
