import { onBeforeUnmount, ref } from "vue";

/** A rectangle in the window, as `getBoundingClientRect` gives it. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** One line of a page as it is drawn: a block, or a row of blocks with the blocks in it. */
export interface DragLine {
  id: string;
  box: Box;
  row: { area: Box; blocks: Box[] } | null;
}

/** A gap a block can be dropped in: before the block at `index` on the page, or in a row of blocks. */
export interface DropPlace {
  blockRowId: string | null;
  index: number;
}

export interface Drop {
  place: DropPlace;
  /** Where to draw the bar that shows the gap. */
  mark: Box;
}

/** How far the pointer moves before a press on a header becomes a drag, so that a click stays a click. */
const SLOP = 6;
const BAR = 4;
/** The distance from a block's edge to the bar where no neighbor sets it. */
const MARGIN = 6;
/** How near the top or bottom of the page's visible part the pointer scrolls it, and how far each frame. */
const SCROLL_ZONE = 48;
const SCROLL_STEP = 14;

const middle = (box: Box, across: boolean): number =>
  across ? (box.left + box.right) / 2 : (box.top + box.bottom) / 2;

/** The bar in the gap before `boxes[index]`, for boxes that run left to right (`across`) or top to bottom. */
function bar(boxes: readonly Box[], index: number, across: boolean, within: Box): Box {
  const start = (box: Box) => (across ? box.left : box.top);
  const end = (box: Box) => (across ? box.right : box.bottom);
  const before = boxes[index - 1];
  const after = boxes[index];
  const at =
    before && after
      ? (end(before) + start(after)) / 2
      : before
        ? end(before) + MARGIN
        : after
          ? start(after) - MARGIN
          : start(within) + MARGIN;
  return across
    ? { left: at - BAR / 2, right: at + BAR / 2, top: within.top, bottom: within.bottom }
    : { left: within.left, right: within.right, top: at - BAR / 2, bottom: at + BAR / 2 };
}

/**
 * Where a dragged block would go if released at `point`. Over the blocks of a
 * row it goes into that row, unless it is a row itself, since a row holds no
 * rows. Anywhere else it goes between the lines of the page.
 */
export function dropPlace(
  point: { x: number; y: number },
  lines: readonly DragLine[],
  draggingRow: boolean,
): Drop | null {
  const first = lines[0];
  const last = lines.at(-1);
  if (!first || !last) return null;
  if (!draggingRow) {
    for (const line of lines) {
      if (!line.row) continue;
      const { area, blocks } = line.row;
      if (
        point.x < area.left ||
        point.x > area.right ||
        point.y < area.top ||
        point.y > area.bottom
      )
        continue;
      // On a narrow screen the blocks of a row stack.
      const [one, two] = blocks;
      const across = !(one && two && two.top >= one.bottom - 1);
      const index = blocks.filter(
        (box) => middle(box, across) < (across ? point.x : point.y),
      ).length;
      return { place: { blockRowId: line.id, index }, mark: bar(blocks, index, across, area) };
    }
  }
  const boxes = lines.map((line) => line.box);
  const index = boxes.filter((box) => middle(box, false) < point.y).length;
  const within = {
    left: Math.min(...boxes.map((box) => box.left)),
    right: Math.max(...boxes.map((box) => box.right)),
    top: first.box.top,
    bottom: last.box.bottom,
  };
  return { place: { blockRowId: null, index }, mark: bar(boxes, index, false, within) };
}

/**
 * Dragging a block or a row of blocks by its header to another place on its
 * page. The press becomes a drag only after the pointer moves, so a click on
 * the header keeps its meaning. Escape cancels.
 */
export function useBlockDrag(options: {
  enabled: () => boolean;
  /** The page's lines as they are drawn now. */
  lines: () => DragLine[];
  /** The top of the part of the page that nothing covers. */
  visibleTop: () => number;
  drop: (id: string, place: DropPlace) => void;
}) {
  /** The id of the block being dragged. */
  const dragged = ref<string | null>(null);
  const mark = ref<Box | null>(null);
  let pressed: { id: string; isRow: boolean; x: number; y: number; pointerId: number } | null =
    null;
  let point = { x: 0, y: 0 };
  let place: DropPlace | null = null;
  let frame = 0;

  function aim(): void {
    const drop = pressed && dropPlace(point, options.lines(), pressed.isRow);
    place = drop?.place ?? null;
    mark.value = drop?.mark ?? null;
  }

  /** Scrolls the page while the pointer is held near its top or bottom. */
  function scroll(): void {
    frame = requestAnimationFrame(() => {
      if (!dragged.value) return;
      const by =
        point.y < options.visibleTop() + SCROLL_ZONE
          ? -SCROLL_STEP
          : point.y > window.innerHeight - SCROLL_ZONE
            ? SCROLL_STEP
            : 0;
      if (by !== 0) {
        window.scrollBy(0, by);
        aim();
      }
      scroll();
    });
  }

  function onMove(event: PointerEvent): void {
    if (event.pointerId !== pressed?.pointerId) return;
    point = { x: event.clientX, y: event.clientY };
    if (!dragged.value) {
      if (Math.hypot(point.x - pressed.x, point.y - pressed.y) < SLOP) return;
      dragged.value = pressed.id;
      // The first few pixels of the press may have begun selecting the header's text.
      window.getSelection()?.removeAllRanges();
      document.documentElement.classList.add("dragging-block");
      scroll();
    }
    event.preventDefault();
    aim();
  }

  const swallowClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
  };

  function finish(commit: boolean): void {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKeydown, true);
    cancelAnimationFrame(frame);
    document.documentElement.classList.remove("dragging-block");
    const id = dragged.value;
    const target = place;
    pressed = null;
    place = null;
    dragged.value = null;
    mark.value = null;
    if (id === null) return;
    // The release ends a drag, so the click it also makes must not rename or open anything.
    window.addEventListener("click", swallowClick, { capture: true, once: true });
    setTimeout(() => {
      window.removeEventListener("click", swallowClick, true);
    });
    if (commit && target) options.drop(id, target);
  }

  function onUp(event: PointerEvent): void {
    if (event.pointerId === pressed?.pointerId) finish(true);
  }

  function onCancel(): void {
    finish(false);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !dragged.value) return;
    event.preventDefault();
    event.stopPropagation();
    finish(false);
  }

  /**
   * Begins watching a press for a drag. `handle` selects the part of the
   * block that can be dragged by; a press on a control inside it is left to
   * the control. A finger scrolls the page, so touch does not drag.
   */
  function press(event: PointerEvent, id: string, isRow: boolean, handle: string): void {
    const target = event.target;
    if (
      pressed ||
      event.button !== 0 ||
      event.pointerType === "touch" ||
      !options.enabled() ||
      !(target instanceof Element) ||
      !target.closest(handle) ||
      target.closest("button, a, input, textarea, select, [contenteditable]")
    )
      return;
    pressed = { id, isRow, x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKeydown, true);
  }

  onBeforeUnmount(() => {
    finish(false);
  });

  return { dragged, mark, press };
}
