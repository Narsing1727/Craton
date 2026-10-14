"use client";

import { cn } from "@/lib/utils";
import { ChevronRight, File, Folder, FolderOpen, Database, Map as MapIcon, Table2, FileText, Cpu } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DataTypeBadge } from "@/components/data-type-badge";
import { Badge } from "@/components/ui/badge";
import { type DataType } from "@/lib/data";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";

export type FileTreeItem = {
  id: string;
  name: string;
  type: "file" | "folder";
  children?: FileTreeItem[];
  icon?: ReactNode;
  badge?: ReactNode;
  size?: string;
  lastCommit?: string;
  updated?: string;
  dataType?: DataType | string;
  href?: string;
};

export type FileTreeProps = {
  /** Additional CSS classes */
  className?: string;
  /** Ids expanded by default (uncontrolled) */
  defaultExpanded?: string[];
  /** Controlled list of expanded folder ids */
  expanded?: string[];
  /** Indentation per level, in pixels */
  indent?: number;
  /** Recursive tree data */
  items: FileTreeItem[];
  /** Called when the expanded set changes */
  onExpandedChange?: (expanded: string[]) => void;
  /** Called when the selected item changes */
  onSelectedChange?: (id: string) => void;
  /** Controlled selected item id */
  selected?: string;
  /** Draw vertical guide lines connecting nested levels */
  showLines?: boolean;
};

const DEFAULT_INDENT = 20;
/** A folder shows this many entries at first; "Show more" adds this many. 5,000 rows in one folder would be 65,000 DOM nodes. */
export const PAGE_SIZE = 200;
const ROTATE_OPEN = 90;
const ROTATE_CLOSED = 0;
const TYPEAHEAD_PATTERN = /^[a-z0-9]$/i;

type FlatNode = {
  item: FileTreeItem;
  level: number;
  parentId: string | null;
};

const flattenVisible = (
  nodes: FileTreeItem[],
  expandedSet: Set<string>,
  level: number,
  parentId: string | null,
  limitFor: (folderId: string | null) => number
): FlatNode[] => {
  const result: FlatNode[] = [];
  for (const node of nodes.slice(0, limitFor(parentId))) {
    result.push({ item: node, level, parentId });
    if (
      node.type === "folder" &&
      node.children &&
      node.children.length > 0 &&
      expandedSet.has(node.id)
    ) {
      result.push(
        ...flattenVisible(node.children, expandedSet, level + 1, node.id, limitFor)
      );
    }
  }
  return result;
};

type FileTreeRowProps = {
  expandedSet: Set<string>;
  limitFor: (folderId: string | null) => number;
  /** `all` is the folder's entry count: reveal every entry, a batch per frame, so the page stays responsive. */
  onShowMore: (folderId: string | null, all?: number) => void;
  focusedId: string | undefined;
  indent: number;
  level: number;
  node: FileTreeItem;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>, id: string) => void;
  onSelect: (id: string) => void;
  onToggle: (id: string, force?: boolean) => void;
  registerRef: (id: string, el: HTMLDivElement | null) => void;
  selectedId: string | undefined;
  showLines: boolean;
};

function getFileIcon(name: string, dataType?: string) {
  if (dataType === "DEM" || name.endsWith(".tif") || name.endsWith(".laz") || name.endsWith(".las")) {
    return <MapIcon className="size-4 text-muted-foreground shrink-0" />;
  }
  if (dataType === "Shapefile" || name.endsWith(".shp") || name.endsWith(".geojson") || name.endsWith(".gpkg")) {
    return <Table2 className="size-4 text-muted-foreground shrink-0" />;
  }
  if (dataType === "HEC-RAS" || dataType === "HEC-HMS" || name.endsWith(".p01") || name.endsWith(".hdf")) {
    return <Cpu className="size-4 text-muted-foreground shrink-0" />;
  }
  if (name.endsWith(".csv") || name.endsWith(".parquet")) {
    return <Table2 className="size-4 text-muted-foreground shrink-0" />;
  }
  if (name.endsWith(".md") || name.endsWith(".txt") || name.endsWith(".json")) {
    return <FileText className="size-4 text-muted-foreground shrink-0" />;
  }
  return <File className="size-4 text-muted-foreground shrink-0" />;
}

/** The row under a long folder: how many are hidden, and two ways to see more. */
function ShowMore({ hidden, level, indent, onMore, onAll }: { hidden: number; level: number; indent: number; onMore: () => void; onAll: () => void }) {
  return (
    <div role="treeitem" aria-level={level} aria-selected={false} className="flex flex-wrap items-center gap-3 border-b border-border/30 px-4 py-2 text-xs text-muted-foreground" style={{ paddingLeft: `${16 + (level - 1) * indent}px` }}>
      <span>{hidden.toLocaleString("en-US")} more not shown</span>
      <button type="button" onClick={onMore} className="text-foreground underline underline-offset-2 hover:no-underline">
        Show {Math.min(PAGE_SIZE, hidden).toLocaleString("en-US")} more
      </button>
      {hidden > PAGE_SIZE && (
        <button type="button" onClick={onAll} className="text-foreground underline underline-offset-2 hover:no-underline">
          Show all
        </button>
      )}
    </div>
  );
}

const FileTreeRow = ({
  node,
  level,
  indent,
  showLines,
  limitFor,
  onShowMore,
  expandedSet,
  selectedId,
  focusedId,
  onToggle,
  onSelect,
  onKeyDown,
  registerRef,
}: FileTreeRowProps) => {
  const router = useRouter();
  const isFolder = node.type === "folder";
  const hasChildren = isFolder && Boolean(node.children?.length);
  const isOpen = hasChildren && expandedSet.has(node.id);
  const isSelected = selectedId === node.id;
  const isFocused = focusedId === node.id;

  // Blue folder icons instead of pink
  const defaultIcon = isFolder ? (
    isOpen ? (
      <FolderOpen className="size-4 text-info fill-info/20 shrink-0" />
    ) : (
      <Folder className="size-4 text-info fill-info/20 shrink-0" />
    )
  ) : (
    node.icon ?? getFileIcon(node.name, node.dataType as string | undefined)
  );

  const handleRowClick = () => {
    onSelect(node.id);
    if (isFolder) {
      onToggle(node.id);
    } else if (node.href) {
      router.push(node.href);
    }
  };

  return (
    // A file row is skipped by the browser's layout and paint until it is near the viewport (see .cv-row in globals.css):
    // a folder of thousands of entries costs what is on screen, not what is in the list. Folders hold their children, so
    // they are left alone.
    <div role="none" className={cn("w-full", !isFolder && "cv-row")}>
      <div
        aria-expanded={isFolder ? isOpen : undefined}
        aria-level={level}
        aria-selected={isSelected}
        className={cn(
          "group flex cursor-pointer select-none items-center gap-2.5 px-4 py-2.5 outline-none transition-colors border-b border-border/30",
          isSelected ? "bg-muted/40 font-medium" : "hover:bg-muted/20"
        )}
        onClick={handleRowClick}
        onKeyDown={(event) => onKeyDown(event, node.id)}
        ref={(el) => registerRef(node.id, el)}
        role="treeitem"
        style={{ paddingLeft: `${16 + (level - 1) * indent}px` }}
        tabIndex={isFocused ? 0 : -1}
      >
        {/* Toggle chevron button */}
        {isFolder ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id);
            }}
            className="flex size-6 shrink-0 items-center justify-center rounded-sm hover:bg-muted text-muted-foreground hover:text-foreground transition-all cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label={isOpen ? `Collapse ${node.name}` : `Expand ${node.name}`}
            aria-expanded={isOpen}
            title={isOpen ? "Collapse" : "Expand"}
          >
            <ChevronRight
              className={cn(
                "size-3.5 transition-transform duration-200",
                isOpen && "rotate-90 text-foreground"
              )}
            />
          </button>
        ) : (
          <span className="size-6 shrink-0" />
        )}

        {/* Folder / File Icon */}
        <span
          className={cn("flex shrink-0 items-center", isFolder && "cursor-pointer")}
          onClick={(e) => {
            if (isFolder) {
              e.stopPropagation();
              onToggle(node.id);
            }
          }}
        >
          {defaultIcon}
        </span>

        {/* Name and Badges */}
        <div className="flex items-center gap-2 min-w-0">
          {node.href && !isFolder ? (
            <Link
              href={node.href}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(node.id);
              }}
              className="inline-block truncate py-0.5 text-sm group-hover:underline text-foreground font-normal"
            >
              {node.name}
            </Link>
          ) : (
            <span
              onClick={(e) => {
                if (isFolder) {
                  e.stopPropagation();
                  onToggle(node.id);
                }
              }}
              className={cn(
                "truncate text-sm text-foreground",
                isFolder ? "font-semibold cursor-pointer hover:underline" : "font-normal"
              )}
            >
              {node.name}
            </span>
          )}

          {isFolder && (
            node.href ? (
              <Link
                href={node.href}
                onClick={(e) => {
                  e.stopPropagation();
                }}
                className="hit-area inline-flex"
                title={`Open /${node.name} directory page`}
              >
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 h-4 border-border text-foreground hover:bg-muted font-mono cursor-pointer transition-colors"
                >
                  subfolder ↗
                </Badge>
              </Link>
            ) : (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 h-4 border-border text-foreground font-mono"
              >
                subfolder
              </Badge>
            )
          )}

          {node.dataType && (
            <DataTypeBadge type={node.dataType as DataType} />
          )}

          {node.badge && (
            <span className="text-xs text-muted-foreground font-mono">
              {node.badge}
            </span>
          )}
        </div>

        {/* Table metadata columns */}
        {node.lastCommit && (
          <span className="ml-auto hidden truncate text-muted-foreground sm:block text-xs font-normal">
            {node.lastCommit}
          </span>
        )}
        {node.size && (
          <span className="w-16 shrink-0 text-right font-mono text-xs text-muted-foreground">
            {node.size}
          </span>
        )}
        {node.updated && (
          <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground md:block">
            {node.updated}
          </span>
        )}
      </div>

      {hasChildren && isOpen && (
        <div
          className={cn(
            // No w-full: with the margin below it would overflow; a block fills what's left.
            "relative",
            showLines &&
              "before:absolute before:inset-y-0 before:w-px before:bg-border/60 before:content-['']"
          )}
          role="group"
          style={{
            marginLeft: showLines ? `${24 + (level - 1) * indent}px` : undefined,
          }}
        >
          {node.children?.slice(0, limitFor(node.id)).map((child) => (
            <FileTreeRow
              limitFor={limitFor}
              onShowMore={onShowMore}
              expandedSet={expandedSet}
              focusedId={focusedId}
              indent={indent}
              key={child.id}
              level={level + 1}
              node={child}
              onKeyDown={onKeyDown}
              onSelect={onSelect}
              onToggle={onToggle}
              registerRef={registerRef}
              selectedId={selectedId}
              showLines={showLines}
            />
          ))}
          {(node.children?.length ?? 0) > limitFor(node.id) && (
            <ShowMore
              hidden={(node.children?.length ?? 0) - limitFor(node.id)}
              level={level + 1}
              indent={indent}
              onMore={() => onShowMore(node.id)}
              onAll={() => onShowMore(node.id, node.children?.length ?? 0)}
            />
          )}
        </div>
      )}
    </div>
  );
};

export const FileTree = ({
  items,
  defaultExpanded,
  expanded: expandedProp,
  onExpandedChange,
  selected: selectedProp,
  onSelectedChange,
  indent = DEFAULT_INDENT,
  showLines = false,
  className,
}: FileTreeProps) => {
  const router = useRouter();
  // Expanded ids are either controlled by the parent or kept here, never both:
  // mirroring them into local state made the parent update mid-render.
  const isExpandedControlled = expandedProp !== undefined;
  const [internalExpanded, setInternalExpanded] = useState<string[]>(() => defaultExpanded ?? []);
  const expandedList = isExpandedControlled ? expandedProp : internalExpanded;
  const expandedSet = useMemo(() => new Set(expandedList), [expandedList]);

  const isSelectedControlled = selectedProp !== undefined;
  const [internalSelected, setInternalSelected] = useState<string | undefined>(
    undefined
  );
  const selectedId = isSelectedControlled ? selectedProp : internalSelected;

  // How many entries of each folder are shown (the top level is keyed ""). Folders start at one page.
  const [limits, setLimits] = useState<Record<string, number>>({});
  const limitsRef = useRef<Record<string, number>>({});
  limitsRef.current = limits;
  const limitFor = useCallback((folderId: string | null) => limits[folderId ?? ""] ?? PAGE_SIZE, [limits]);
  const showMore = useCallback((folderId: string | null, all?: number) => {
    const key = folderId ?? "";
    if (all === undefined) {
      setLimits((prev) => ({ ...prev, [key]: (prev[key] ?? PAGE_SIZE) + PAGE_SIZE }));
      return;
    }
    // "Show all" on thousands of rows in one render holds the main thread for seconds (an interaction Google counts as
    // poor above 500 ms). Reveal a batch per frame instead: the click answers at once and the list fills in.
    const BATCH = 400;
    const step = () => {
      const next = Math.min(all, (limitsRef.current[key] ?? PAGE_SIZE) + BATCH);
      // Keep the ref ahead of the state, so the next frame continues from here even before React has rendered this one.
      limitsRef.current = { ...limitsRef.current, [key]: next };
      setLimits(limitsRef.current);
      if (next < all) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);

  const flatList = useMemo(
    () => flattenVisible(items, expandedSet, 1, null, limitFor),
    [items, expandedSet, limitFor]
  );
  const [focusedId, setFocusedId] = useState<string | undefined>(undefined);
  const activeFocusId = focusedId ?? selectedId ?? flatList[0]?.item.id;

  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const registerRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) {
      itemRefs.current.set(id, el);
    } else {
      itemRefs.current.delete(id);
    }
  }, []);
  const focusItem = useCallback((id: string | undefined) => {
    if (id) {
      itemRefs.current.get(id)?.focus();
    }
  }, []);

  const toggleExpanded = useCallback(
    (id: string, force?: boolean) => {
      const isCurrentlyOpen = expandedSet.has(id);
      const shouldOpen = force ?? !isCurrentlyOpen;
      if (shouldOpen === isCurrentlyOpen) return;

      const next = shouldOpen
        ? [...expandedList, id]
        : expandedList.filter((existing) => existing !== id);

      if (!isExpandedControlled) setInternalExpanded(next);
      onExpandedChange?.(next);
    },
    [expandedSet, expandedList, isExpandedControlled, onExpandedChange]
  );

  const handleSelect = useCallback(
    (id: string) => {
      if (!isSelectedControlled) {
        setInternalSelected(id);
      }
      onSelectedChange?.(id);
      setFocusedId(id);
    },
    [isSelectedControlled, onSelectedChange]
  );

  const flatIndexById = useMemo(() => {
    const map = new Map<string, number>();
    for (const [index, entry] of flatList.entries()) {
      map.set(entry.item.id, index);
    }
    return map;
  }, [flatList]);

  const moveFocusTo = useCallback(
    (id: string | undefined) => {
      if (!id) {
        return;
      }
      setFocusedId(id);
      focusItem(id);
    },
    [focusItem]
  );

  const typeahead = useCallback(
    (letter: string, fromIndex: number) => {
      const lower = letter.toLowerCase();
      const count = flatList.length;
      for (let offset = 1; offset <= count; offset++) {
        const index = (fromIndex + offset) % count;
        if (flatList[index].item.name.toLowerCase().startsWith(lower)) {
          moveFocusTo(flatList[index].item.id);
          return;
        }
      }
    },
    [flatList, moveFocusTo]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, id: string) => {
      const index = flatIndexById.get(id);
      if (index === undefined) {
        return;
      }
      const entry = flatList[index];
      const node = entry.item;

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          moveFocusTo(flatList[index + 1]?.item.id);
          break;
        case "ArrowUp":
          event.preventDefault();
          moveFocusTo(flatList[index - 1]?.item.id);
          break;
        case "ArrowRight":
          event.preventDefault();
          if (node.type === "folder") {
            if (expandedSet.has(node.id)) {
              const next = flatList[index + 1];
              if (next && next.parentId === node.id) {
                moveFocusTo(next.item.id);
              }
            } else {
              toggleExpanded(node.id, true);
            }
          }
          break;
        case "ArrowLeft":
          event.preventDefault();
          if (node.type === "folder" && expandedSet.has(node.id)) {
            toggleExpanded(node.id, false);
          } else if (entry.parentId) {
            moveFocusTo(entry.parentId);
          }
          break;
        case "Home":
          event.preventDefault();
          moveFocusTo(flatList[0]?.item.id);
          break;
        case "End":
          event.preventDefault();
          moveFocusTo(flatList.at(-1)?.item.id);
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          handleSelect(node.id);
          // Enter acts like a click: folders open/close, files open.
          if (node.type === "folder") toggleExpanded(node.id);
          else if (event.key === "Enter" && node.href) router.push(node.href);
          break;
        default:
          if (TYPEAHEAD_PATTERN.test(event.key)) {
            event.preventDefault();
            typeahead(event.key, index);
          }
          break;
      }
    },
    [
      flatIndexById,
      flatList,
      expandedSet,
      toggleExpanded,
      moveFocusTo,
      handleSelect,
      typeahead,
      router,
    ]
  );

  return (
    <div className={cn("select-none text-sm w-full divide-y divide-transparent", className)} role="tree">
      {items.slice(0, limitFor(null)).map((node) => (
        <FileTreeRow
          limitFor={limitFor}
          onShowMore={showMore}
          expandedSet={expandedSet}
          focusedId={activeFocusId}
          indent={indent}
          key={node.id}
          level={1}
          node={node}
          onKeyDown={handleKeyDown}
          onSelect={handleSelect}
          onToggle={toggleExpanded}
          registerRef={registerRef}
          selectedId={selectedId}
          showLines={showLines}
        />
      ))}
      {items.length > limitFor(null) && (
        <ShowMore hidden={items.length - limitFor(null)} level={1} indent={indent} onMore={() => showMore(null)} onAll={() => showMore(null, items.length)} />
      )}
    </div>
  );
};

export default FileTree;
