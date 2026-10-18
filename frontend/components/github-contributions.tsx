"use client"

import { use } from "react"
import { format } from "date-fns"

import { cn } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { Activity } from "@/components/contribution-graph"
import {
  ContributionGraph,
  ContributionGraphBlock,
  ContributionGraphCalendar,
  ContributionGraphFooter,
  ContributionGraphLegend,
  ContributionGraphTotalCount,
} from "@/components/contribution-graph"

export function GitHubContributions({
  contributions,
  className,
}: {
  contributions: Promise<Activity[]> | Activity[]
  githubProfileUrl?: string
  className?: string
}) {
  const data = contributions instanceof Promise ? use(contributions) : contributions

  return (
    <ContributionGraph
      className={cn("w-full py-2", className)}
      data={data}
      blockSize={11}
      blockMargin={3}
      blockRadius={0}
      fontSize={11}
    >
      <ContributionGraphCalendar
        className="no-scrollbar px-1 w-full"
        title="Craton activity"
      >
        {({ activity, dayIndex, weekIndex }) => (
          <Tooltip>
            <TooltipTrigger
              render={
                <g>
                  <ContributionGraphBlock
                    activity={activity}
                    dayIndex={dayIndex}
                    weekIndex={weekIndex}
                  />
                </g>
              }
            />
            <TooltipContent className="font-sans text-xs">
              <p>
                {activity.count} contribution{activity.count !== 1 ? "s" : ""}{" "}
                on {format(new Date(activity.date), "dd.MM.yyyy")}
              </p>
            </TooltipContent>
          </Tooltip>
        )}
      </ContributionGraphCalendar>

      <ContributionGraphFooter className="px-1 pt-3 flex flex-wrap items-center justify-between text-xs border-t border-border/20 mt-3">
        <ContributionGraphTotalCount>
          {({ totalCount }) => (
            <div className="text-muted-foreground font-mono text-[11px]">
              <span className="font-bold text-foreground">{totalCount.toLocaleString("en")}</span> commits, reviews and releases in the last year
            </div>
          )}
        </ContributionGraphTotalCount>

        <ContributionGraphLegend />
      </ContributionGraphFooter>
    </ContributionGraph>
  )
}

export function GitHubContributionsFallback() {
  return (
    <div className="flex h-40 w-full items-center justify-center">
      <Spinner className="text-muted-foreground size-5" />
    </div>
  )
}
