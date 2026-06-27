"use client";

import {AlertTriangle, ArrowDownToLine, Radio, Zap} from "lucide-react";

import {ProviderIcon} from "@/components/provider-icon";
import {StatusTimeline} from "@/components/status-timeline";
import {AvailabilityStats} from "@/components/availability-stats";
import {Badge} from "@/components/ui/badge";
import type {AvailabilityPeriod, AvailabilityStat, ProviderTimeline} from "@/lib/types";
import {OFFICIAL_STATUS_META, PROVIDER_LABEL, STATUS_META} from "@/lib/core/status";
import {cn} from "@/lib/utils";

interface ProviderCardProps {
  timeline: ProviderTimeline;
  timeToNextRefresh: number | null;
  availabilityStats?: AvailabilityStat[] | null;
  selectedPeriod: AvailabilityPeriod;
}

const formatLatency = (value: number | null | undefined) =>
  typeof value === "number" ? `${value} ms` : "—";

/** Tech-style decorative corner plus marker */
const CornerPlus = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1"
    className={cn("absolute h-4 w-4 text-muted-foreground/40", className)}
  >
    <line x1="12" y1="0" x2="12" y2="24" />
    <line x1="0" y1="12" x2="24" y2="12" />
  </svg>
);

export function ProviderCard({
  timeline,
  timeToNextRefresh,
  availabilityStats,
  selectedPeriod,
}: ProviderCardProps) {
  const { latest, items } = timeline;
  const preset = STATUS_META[latest.status];
  const isMaintenance = latest.status === "maintenance";
  const officialStatus = latest.officialStatus;
  const officialStatusMeta = officialStatus
    ? OFFICIAL_STATUS_META[officialStatus.status]
    : null;
  const banner = officialStatusMeta?.bannerLabel ? officialStatusMeta : null;

  // 优先显示当前实际生效的模型（自动降级后）
  const effectiveModel = latest.activeModel && latest.activeModel.length > 0
    ? latest.activeModel
    : latest.model;
  const isFallback = Boolean(latest.isFallback) && effectiveModel !== latest.model;

  return (
    <div className={cn(
      "group relative flex flex-col overflow-hidden rounded-2xl border bg-background/40 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/5 md:flex-row",
      banner
        ? banner.bannerBorder
        : "border-border/40 hover:border-primary/20"
    )}>
      <CornerPlus className="left-2 top-2 opacity-0 transition-opacity group-hover:opacity-100" />
      <CornerPlus className="right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100" />

      {banner && officialStatus && (
        <div className={cn(
          "flex items-start gap-2.5 border-b px-4 py-2.5 sm:px-5 sm:py-3 md:absolute md:left-0 md:right-0 md:top-full md:z-10 md:rounded-b-2xl md:border-t md:border-b-0",
          banner.bannerBg
        )}>
          <div className="relative mt-0.5 flex-shrink-0">
            <AlertTriangle className="h-4 w-4" />
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-current animate-pulse" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold sm:text-sm">
              {banner.bannerLabel}
            </p>
            <p className="mt-0.5 text-[11px] leading-snug opacity-80 sm:text-xs">
              {officialStatus.message || banner.description}
            </p>
            {officialStatus.affectedComponents && officialStatus.affectedComponents.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {officialStatus.affectedComponents.map((c, i) => (
                  <span key={`${c}-${i}`} className="rounded bg-current/10 px-1.5 py-0.5 text-[10px] font-medium">
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 左列：图标 + 名称 + 类型/模型 + 状态徽章 */}
      <div className={cn(
        "flex shrink-0 items-center gap-3 border-b border-border/40 p-4 sm:p-5 md:w-64 md:flex-col md:items-stretch md:gap-3 md:border-b-0 md:border-r",
        banner && "opacity-60"
      )}>
        <div className="flex items-center gap-3 md:items-start md:justify-between">
          <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-white/80 to-white/20 shadow-sm ring-1 ring-black/5 transition-transform group-hover:scale-105 dark:from-white/10 dark:to-white/5 dark:ring-white/10 sm:h-12 sm:w-12 sm:rounded-2xl">
            <div className="scale-75 sm:scale-100">
              <ProviderIcon type={latest.type} size={26} className="text-foreground/80" />
            </div>
          </div>
          <div className="md:hidden">
            <Badge
              variant={preset.badge}
              className="shrink-0 whitespace-nowrap rounded-lg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider shadow-sm backdrop-blur-md sm:px-2.5 sm:py-1 sm:text-xs"
            >
              {preset.label}
            </Badge>
          </div>
        </div>

        <div className="min-w-0 flex-1 md:flex-none">
          <h3 className="line-clamp-2 text-base font-bold leading-tight tracking-tight text-foreground sm:text-lg">
            {latest.name}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:text-sm">
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-semibold text-foreground/70">
              {PROVIDER_LABEL[latest.type]}
            </span>
            <span
              className={cn(
                "truncate font-mono font-medium",
                isFallback ? "text-amber-600 dark:text-amber-400" : "text-foreground/50"
              )}
              title={
                isFallback
                  ? `原首选 ${latest.model} 不可用，已自动降级`
                  : effectiveModel
              }
            >
              {effectiveModel}
            </span>
            {isFallback && (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400"
                title={`首选模型 ${latest.model} 不可用，已自动降级到 ${effectiveModel}`}
              >
                <ArrowDownToLine className="h-3 w-3" />
                降级
              </span>
            )}
          </div>
          <div className="hidden md:block md:pt-2">
            <Badge
              variant={preset.badge}
              className="shrink-0 whitespace-nowrap rounded-lg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider shadow-sm backdrop-blur-md sm:px-2.5 sm:py-1 sm:text-xs"
            >
              {preset.label}
            </Badge>
          </div>
        </div>
      </div>

      {/* 中列：延迟 + PING + 可用性统计 */}
      <div className={cn(
        "flex flex-1 flex-col gap-3 p-4 sm:p-5 md:gap-4",
        banner && "opacity-60"
      )}>
        {/* 延迟与 PING 横向并排 */}
        <div className="grid grid-cols-2 gap-3 md:gap-4">
          <div className="rounded-xl bg-muted/30 p-3 transition-colors group-hover:bg-muted/50">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Zap className="h-3.5 w-3.5" />
              <span className="text-[10px] font-semibold uppercase tracking-wider">对话延迟</span>
            </div>
            <div className="mt-1 font-mono text-lg font-medium leading-none text-foreground">
              {formatLatency(latest.latencyMs)}
            </div>
          </div>

          <div className="rounded-xl bg-muted/30 p-3 transition-colors group-hover:bg-muted/50">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Radio className="h-3.5 w-3.5" />
              <span className="text-[10px] font-semibold uppercase tracking-wider">端点 PING</span>
            </div>
            <div className="mt-1 font-mono text-lg font-medium leading-none text-foreground">
              {formatLatency(latest.pingLatencyMs)}
            </div>
          </div>
        </div>

        {/* 可用性统计 */}
        <div className="border-t border-border/30 pt-3 md:pt-4">
          <AvailabilityStats stats={availabilityStats} period={selectedPeriod} isMaintenance={isMaintenance} />
        </div>
      </div>

      {/* 右列：时间轴 */}
      <div className="border-t border-border/40 bg-muted/10 px-4 py-4 sm:px-5 md:w-72 md:shrink-0 md:border-l md:border-t-0">
        <StatusTimeline items={items} nextRefreshInMs={timeToNextRefresh} isMaintenance={isMaintenance} />
      </div>
    </div>
  );
}