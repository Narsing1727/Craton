import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  MoreVertical,
  Download,
  ChevronDown,
  Check,
  Printer,
  Share2,
  RefreshCw,
} from 'lucide-react';

interface UsageHistoryItem {
  date: string;
  model: string;
  credits: string;
  cost: string;
}

interface CreditUsageCardProps {
  usedCreditsPercent?: number;
  totalCreditsLabel?: string;
  creditsUsedLabel?: string;
  creditsLeftLabel?: string;
  usageHistory?: UsageHistoryItem[];
  onAutoSwitchChange?: (enabled: boolean) => void;
  onManagePlan?: () => void;
  onViewAll?: () => void;
}

const PERIOD_OPTIONS = ['7 Days', '14 Days', '30 Days', '90 Days', '12 Months'];

const popoverAnim = {
  initial: { opacity: 0, y: 6, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 6, scale: 0.97 },
  transition: { type: 'spring' as const, stiffness: 400, damping: 28 },
} as const;

export const CreditUsageCard: React.FC<CreditUsageCardProps> = ({
  usedCreditsPercent = 56.4,
  totalCreditsLabel = '100M CREDITS',
  creditsUsedLabel = '56.4M',
  creditsLeftLabel = '43.6M',
  usageHistory = [],
  onAutoSwitchChange,
  onManagePlan,
  onViewAll,
}) => {
  const [autoSwitch, setAutoSwitch] = useState(true);
  const [activePopover, setActivePopover] = useState<'more' | 'period' | null>(
    null,
  );
  const [selectedPeriod, setSelectedPeriod] = useState('30 Days');
  const [downloadDone, setDownloadDone] = useState(false);
  const segments = 75;

  const moreRef = useRef<HTMLDivElement>(null);
  const periodRef = useRef<HTMLDivElement>(null);

  const handleToggleAutoSwitch = () => {
    const newState = !autoSwitch;
    setAutoSwitch(newState);
    onAutoSwitchChange?.(newState);
  };

  const handleDownload = () => {
    // Simulate CSV export
    const headers = ['Date', 'Model', 'Credits', 'Cost'];
    const rows = usageHistory.map((r) => [r.date, r.model, r.credits, r.cost]);
    const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'credit-usage.csv';
    a.click();
    URL.revokeObjectURL(url);
    setDownloadDone(true);
    setTimeout(() => setDownloadDone(false), 2000);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setActivePopover((prev) => (prev === 'more' ? null : prev));
      }
      if (periodRef.current && !periodRef.current.contains(e.target as Node)) {
        setActivePopover((prev) => (prev === 'period' ? null : prev));
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="flex w-full flex-col items-center justify-center bg-transparent p-4 font-sans transition-colors duration-500 sm:p-8 md:p-12">
      <div className="w-full max-w-135 overflow-hidden rounded-4xl border border-border bg-white font-mono text-slate-700 shadow-xl transition-all duration-500 select-none dark:border-border dark:bg-card dark:text-foreground">
        {/* Top Header */}
        <div className="flex flex-col items-start justify-between gap-4 bg-gray-50/50 px-4 py-5 sm:flex-row sm:items-center sm:px-6 md:px-8 dark:bg-card">
          <div>
            <h3 className="mb-1 text-[9px] font-bold tracking-[0.2em] text-muted-foreground uppercase">
              Credits Used
            </h3>
            <span className="inter text-2xl font-medium text-slate-900 sm:text-3xl dark:text-foreground">
              {usedCreditsPercent}%
            </span>
          </div>

          <div className="mt-1 flex items-center gap-2 self-end sm:self-auto">
            <span className="max-w-37.5 text-right text-[9px] leading-tight font-bold tracking-wider text-muted-foreground uppercase sm:text-[10px]">
              Auto-switch to cheaper model at limit
            </span>
            <button
              title="toggle"
              onClick={handleToggleAutoSwitch}
              className={`relative flex h-4.75 w-10 shrink-0 items-center rounded-full border-[1.4px] p-0.5 transition-colors duration-200 ${
                autoSwitch
                  ? 'border-success/40 bg-background dark:border-success/40 dark:bg-muted'
                  : 'border-gray-300 bg-gray-200 dark:border-border dark:bg-muted'
              }`}
            >
              <motion.div
                animate={{ x: autoSwitch ? 17 : 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className={`h-3 w-4 ${autoSwitch ? 'bg-success dark:bg-success' : 'bg-gray-400 dark:bg-muted'} rounded-full shadow-sm`}
              />
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="flex h-3 gap-px bg-gray-50/50 px-4 sm:gap-1 sm:px-6 md:px-8 dark:bg-card">
          {[...Array(segments)].map((_, i) => {
            const isFilled = i < (usedCreditsPercent / 100) * segments;
            return (
              <div
                key={i}
                className={`flex-1 rounded-full transition-all duration-700 ${
                  isFilled ? 'bg-destructive' : 'bg-gray-200 dark:bg-muted'
                }`}
                style={{ opacity: isFilled ? 1 - i * 0.004 : 1 }}
              />
            );
          })}
        </div>

        <div className="flex items-center justify-between bg-gray-50/50 px-4 py-4 text-[9px] font-bold sm:px-6 sm:text-[10px] md:px-8 dark:bg-card">
          <span className="text-slate-500 dark:text-foreground">
            {creditsUsedLabel}{' '}
            <span className="text-slate-400 dark:text-muted-foreground">
              / {totalCreditsLabel}
            </span>
          </span>
          <span className="text-slate-500 dark:text-foreground">
            {creditsLeftLabel}{' '}
            <span className="xs:inline hidden text-slate-400 dark:text-muted-foreground">
              CREDITS LEFT
            </span>
          </span>
        </div>

        <div className="h-px w-full border-b-2 border-dashed border-black/5 dark:border-white/10" />

        {/* History Header */}
        <div className="flex flex-row flex-wrap items-center justify-between gap-2 bg-gray-50/50 px-4 pt-4 pb-4 sm:flex-nowrap sm:px-6 md:px-8 dark:bg-card">
          <div className="flex flex-shrink-0 items-center gap-2">
            <h4 className="inter text-sm font-medium whitespace-nowrap text-slate-800 sm:text-base dark:text-foreground">
              Usage History
            </h4>
            <button
              onClick={onViewAll}
              title="view all"
              className="flex-shrink-0 rounded-full border border-gray-300 px-2 py-0.5 text-center text-[9px] whitespace-nowrap text-gray-500 transition-colors hover:bg-gray-100 active:scale-95 dark:border-border/65 dark:text-muted-foreground dark:hover:bg-card"
            >
              View all
            </button>
          </div>

          {/* Period selector */}
          <div ref={periodRef} className="relative flex-shrink-0">
            <button
              title="period"
              onClick={() =>
                setActivePopover((prev) =>
                  prev === 'period' ? null : 'period',
                )
              }
              className="flex items-center gap-1 rounded-xl border border-gray-300 px-2 py-1 text-[9px] whitespace-nowrap text-gray-500 transition-colors hover:bg-gray-100 sm:gap-2 dark:border-border/65 dark:text-muted-foreground dark:hover:bg-card"
            >
              {selectedPeriod}{' '}
              <ChevronDown
                size={10}
                className={`transition-transform ${activePopover === 'period' ? 'rotate-180' : ''}`}
              />
            </button>
            <AnimatePresence>
              {activePopover === 'period' && (
                <motion.div
                  {...popoverAnim}
                  className="absolute top-full right-0 z-50 mt-2 w-36 overflow-hidden rounded-2xl border border-gray-200 bg-white py-1.5 shadow-2xl dark:border-border dark:bg-card"
                >
                  {PERIOD_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => {
                        setSelectedPeriod(opt);
                        setActivePopover(null);
                      }}
                      className={`flex w-full items-center justify-between px-4 py-2 text-left text-[11px] transition-colors ${selectedPeriod === opt ? 'text-destructive' : 'text-gray-600 hover:bg-gray-50 dark:text-muted-foreground dark:hover:bg-muted'}`}
                    >
                      {opt}
                      {selectedPeriod === opt && <Check size={11} />}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Table Wrapper */}
        <div className="no-scrollbar overflow-x-auto bg-gray-50/50 dark:bg-card">
          <div className="min-w-120 space-y-0.5 border-b-[1.4px] border-gray-200 px-4 py-2 sm:px-6 md:px-8 dark:border-border/60">
            <div className="grid grid-cols-4 px-1 pb-2 text-[10px] font-bold tracking-[0.15em] text-slate-400 uppercase dark:text-muted-foreground">
              <span>Date</span>
              <span>Model</span>
              <span className="text-right">Credits</span>
              <span className="text-right">Cost</span>
            </div>
            {usageHistory.map((row, idx) => (
              <div
                key={idx}
                className="group grid grid-cols-4 border-t-[1.5px] border-gray-100 px-1 py-2 text-[10.5px] text-slate-500 transition-colors hover:bg-white dark:border-border dark:text-muted-foreground dark:hover:bg-card"
              >
                <span className="group-hover:text-slate-900 dark:group-hover:text-white/80">
                  {row.date}
                </span>
                <span className="truncate pr-2 font-medium group-hover:text-slate-900 dark:group-hover:text-white/80">
                  {row.model}
                </span>
                <span className="text-right group-hover:text-slate-900 dark:group-hover:text-white/80">
                  {row.credits}
                </span>
                <span className="text-right font-bold group-hover:text-slate-900 dark:group-hover:text-white/80">
                  {row.cost}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer*/}
        <div className="flex flex-col items-center justify-between gap-4 bg-white px-4 pt-4 pb-4 sm:flex-row sm:px-6 md:px-8 dark:bg-card">
          <div className="flex items-center gap-3 self-start text-slate-400 sm:self-auto dark:text-muted-foreground">
            {/* More Options */}
            <div ref={moreRef} className="relative flex items-center">
              <button
                title="more"
                onClick={() =>
                  setActivePopover((prev) => (prev === 'more' ? null : 'more'))
                }
                className="flex items-center justify-center"
              >
                <MoreVertical
                  size={16}
                  className="cursor-pointer transition-colors hover:text-slate-900 dark:hover:text-white"
                />
              </button>
              <AnimatePresence>
                {activePopover === 'more' && (
                  <motion.div
                    {...popoverAnim}
                    className="absolute bottom-full left-0 z-50 mb-2 w-44 overflow-hidden rounded-2xl border border-gray-200 bg-white py-1.5 shadow-2xl dark:border-border dark:bg-card"
                  >
                    {[
                      {
                        label: 'Export CSV',
                        icon: <Download size={12} />,
                        action: handleDownload,
                      },
                      {
                        label: 'Print',
                        icon: <Printer size={12} />,
                        action: () => {
                          window.print();
                          setActivePopover(null);
                        },
                      },
                      {
                        label: 'Share report',
                        icon: <Share2 size={12} />,
                        action: () => setActivePopover(null),
                      },
                      {
                        label: 'Refresh data',
                        icon: <RefreshCw size={12} />,
                        action: () => setActivePopover(null),
                      },
                    ].map((opt) => (
                      <button
                        key={opt.label}
                        onClick={opt.action}
                        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[12px] text-gray-600 transition-colors hover:bg-gray-50 dark:text-muted-foreground dark:hover:bg-muted"
                      >
                        <span className="text-gray-400 dark:text-muted-foreground">
                          {opt.icon}
                        </span>
                        {opt.label}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="h-4 w-px bg-gray-200 dark:bg-muted" />

            {/* Download CSV */}
            <button
              title="download"
              onClick={handleDownload}
              className="relative flex items-center justify-center"
            >
              <motion.div
                animate={{ scale: downloadDone ? 1.15 : 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                className="flex items-center justify-center"
              >
                <Download
                  size={16}
                  className={`cursor-pointer transition-colors ${downloadDone ? 'text-success dark:text-success' : 'hover:text-slate-900 dark:hover:text-white'}`}
                />
              </motion.div>
            </button>
          </div>

          <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
            <div className="flex items-center gap-1.5 py-1">
              <div className="flex h-4 w-4 items-center justify-center rounded-full bg-info text-[10px] font-semibold text-white">
                S
              </div>
              <span className="text-[9px] font-bold tracking-tighter text-slate-400 uppercase dark:text-muted-foreground">
                Billing via Stripe
              </span>
            </div>
            <button
              title="plans"
              onClick={onManagePlan}
              className="inter rounded-full border border-gray-200 px-3 py-1.5 text-[10px] font-normal whitespace-nowrap text-slate-600 transition-all hover:bg-slate-900 hover:text-white sm:text-[11px] dark:border-border dark:text-white/70 dark:hover:bg-white dark:hover:text-black"
            >
              Manage plan
            </button>
          </div>
        </div>
      </div>

      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
};
