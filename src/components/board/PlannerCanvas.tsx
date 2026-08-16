import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { Tool } from "../../types/planner";

const WORLD_WIDTH = 1600;
const WORLD_HEIGHT = 900;
const PLANNER_IMAGE_DRAG_MIME = "application/x-phightplan-image";

export type EraserMode = "stroke" | "area";
export type ShapeKind = "arrow" | "circle" | "rectangle";
export type PlannerImageBackgroundShape = "circle" | "rounded-rect";
export type PlannerImageTeamSwapRequest = {
  requestId: string;
};

export type PlannerImagePreset = {
  requestId: string;
  src: string;
  backgroundColor?: string;
  backgroundShape?: PlannerImageBackgroundShape;
  width?: number;
  height?: number;
};

export type PlannerSelection =
  | {
      type: "text";
      fontSize: number;
    }
  | {
      type: "image";
    }
  | {
      type: "pen";
    }
  | {
      type: "arrow";
      color: string;
      width: number;
      opacity: number;
    }
  | {
      type: "shape";
      shape: "circle" | "rectangle";
      color: string;
      border: boolean;
      borderWidth: number;
      opacity: number;
      rotation: number;
    }
  | null;

type PlannerCanvasProps = {
  activeTool: Tool;
  activeColor: string;
  strokeSize: number;
  shapeKind: ShapeKind;
  shapeBorder: boolean;
  shapeOpacity: number;
  shapeRotation: number;
  textSize: number;
  eraserMode: EraserMode;
  eraserSize: number;
  mapId: string;
  mapUrl: string;
  itemsByMap: PlannerItemsByMap;
  onItemsByMapChange: Dispatch<SetStateAction<PlannerItemsByMap>>;
  historyResetKey: number;
  textSizeGestureKey: number;
  shapeStyleGestureKey: number;
  imagePreset: PlannerImagePreset | null;
  imageTeamSwapRequest: PlannerImageTeamSwapRequest | null;
  onToolChange: (tool: Tool) => void;
  onSelectionChange: (selection: PlannerSelection) => void;
};

type Point = {
  x: number;
  y: number;
};

type Viewport = {
  x: number;
  y: number;
  scale: number;
};

export type BoardItem =
  | {
      id: string;
      type: "pen";
      points: Point[];
      color: string;
      width: number;
    }
  | {
      id: string;
      type: "arrow";
      start: Point;
      end: Point;
      color: string;
      width: number;
      opacity?: number;
    }
  | {
      id: string;
      type: "shape";
      shape: "circle" | "rectangle";
      x: number;
      y: number;
      width: number;
      height: number;
      color: string;
      border: boolean;
      borderWidth: number;
      opacity: number;
      rotation?: number;
    }
  | {
      id: string;
      type: "text";
      x: number;
      y: number;
      width: number;
      height: number;
      text: string;
      color: string;
      fontSize: number;
    }
  | {
      id: string;
      type: "image";
      x: number;
      y: number;
      width: number;
      height: number;
      src: string;
      backgroundColor?: string;
      backgroundShape?: PlannerImageBackgroundShape;
    };

export type PlannerItemsByMap = Record<string, BoardItem[]>;

type PendingImage = {
  src: string;
  width: number;
  height: number;
  backgroundColor?: string;
  backgroundShape?: PlannerImageBackgroundShape;
};

type DraggedPlannerImage = {
  src: string;
  width: number;
  height: number;
  backgroundColor?: string;
  backgroundShape?: PlannerImageBackgroundShape;
};

type Action =
  | "pan"
  | "pen"
  | "arrow"
  | "shape"
  | "erase"
  | "move"
  | "resize"
  | "rotate"
  | null;

type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

type ResizeState = {
  id: string;
  handle: ResizeHandle;
  original: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

type RotationState = {
  id: string;
  center: Point;
  startPointerAngle: number;
  originalRotation: number;
  currentRotation: number;
};

type ResizableItem = Extract<BoardItem, { type: "text" | "image" | "shape" }>;
type ItemsUpdate = BoardItem[] | ((current: BoardItem[]) => BoardItem[]);

function resizeCursor(handle: ResizeHandle) {
  if (handle === "n" || handle === "s") {
    return "ns-resize";
  }

  if (handle === "e" || handle === "w") {
    return "ew-resize";
  }

  return handle === "nw" || handle === "se" ? "nwse-resize" : "nesw-resize";
}

function distanceToSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const progress = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    ),
  );

  return Math.hypot(
    point.x - (start.x + progress * dx),
    point.y - (start.y + progress * dy),
  );
}

function orientation(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointIsOnSegment(point: Point, start: Point, end: Point) {
  const epsilon = 0.0001;

  return (
    Math.abs(orientation(start, end, point)) <= epsilon &&
    point.x >= Math.min(start.x, end.x) - epsilon &&
    point.x <= Math.max(start.x, end.x) + epsilon &&
    point.y >= Math.min(start.y, end.y) - epsilon &&
    point.y <= Math.max(start.y, end.y) + epsilon
  );
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point) {
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);

  if (
    ((first > 0 && second < 0) || (first < 0 && second > 0)) &&
    ((third > 0 && fourth < 0) || (third < 0 && fourth > 0))
  ) {
    return true;
  }

  return (
    pointIsOnSegment(c, a, b) ||
    pointIsOnSegment(d, a, b) ||
    pointIsOnSegment(a, c, d) ||
    pointIsOnSegment(b, c, d)
  );
}

function distanceBetweenSegments(a: Point, b: Point, c: Point, d: Point) {
  if (segmentsCross(a, b, c, d)) {
    return 0;
  }

  return Math.min(
    distanceToSegment(a, c, d),
    distanceToSegment(b, c, d),
    distanceToSegment(c, a, b),
    distanceToSegment(d, a, b),
  );
}

function segmentTouchesRectangle(
  start: Point,
  end: Point,
  item: Extract<BoardItem, { type: "text" | "image" | "shape" }>,
  radius: number,
) {
  const left = item.x - radius;
  const top = item.y - radius;
  const right = item.x + item.width + radius;
  const bottom = item.y + item.height + radius;

  const inside = (point: Point) =>
    point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;

  if (inside(start) || inside(end)) {
    return true;
  }

  const topLeft = { x: left, y: top };
  const topRight = { x: right, y: top };
  const bottomRight = { x: right, y: bottom };
  const bottomLeft = { x: left, y: bottom };

  return (
    segmentsCross(start, end, topLeft, topRight) ||
    segmentsCross(start, end, topRight, bottomRight) ||
    segmentsCross(start, end, bottomRight, bottomLeft) ||
    segmentsCross(start, end, bottomLeft, topLeft)
  );
}

export function PlannerCanvas({
  activeTool,
  activeColor,
  strokeSize,
  shapeKind,
  shapeBorder,
  shapeOpacity,
  shapeRotation,
  textSize,
  eraserMode,
  eraserSize,
  mapId,
  mapUrl,
  itemsByMap,
  onItemsByMapChange,
  historyResetKey,
  textSizeGestureKey,
  shapeStyleGestureKey,
  imagePreset,
  imageTeamSwapRequest,
  onToolChange,
  onSelectionChange,
}: PlannerCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const eraserCursorElementRef = useRef<SVGCircleElement | null>(null);
  const pendingUploadPointRef = useRef<Point | null>(null);
  const spacePressedRef = useRef(false);

  const initializedRef = useRef(false);
  const actionRef = useRef<Action>(null);
  const activeItemIdRef = useRef<string | null>(null);
  const lastErasePointRef = useRef<Point | null>(null);
  const shapeStartRef = useRef<Point | null>(null);
  const selectedItemIdRef = useRef<string | null>(null);
  const itemsByMapRef = useRef(itemsByMap);
  const historyRef = useRef<PlannerItemsByMap[]>([]);

  const resizeStateRef = useRef<ResizeState | null>(null);
  const rotationStateRef = useRef<RotationState | null>(null);

  const dragOffsetRef = useRef({
    x: 0,
    y: 0,
  });

  const panStartRef = useRef({
    pointerX: 0,
    pointerY: 0,
    viewX: 0,
    viewY: 0,
  });

  const [size, setSize] = useState({
    width: 0,
    height: 0,
  });

  const [viewport, setViewport] = useState<Viewport>({
    x: 0,
    y: 0,
    scale: 1,
  });

  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const [editingTextId, setEditingTextId] = useState<string | null>(null);

  const [spacePanReady, setSpacePanReady] = useState(false);

  const items = itemsByMap[mapId] ?? [];

  useEffect(() => {
    itemsByMapRef.current = itemsByMap;
  }, [itemsByMap]);

  useEffect(() => {
    historyRef.current = [];
  }, [historyResetKey]);

  useEffect(() => {
    function isEditingText(target: EventTarget | null) {
      const element = target as HTMLElement | null;

      return (
        element?.isContentEditable ||
        element?.tagName === "INPUT" ||
        element?.tagName === "TEXTAREA" ||
        element?.tagName === "SELECT"
      );
    }

    function startSpacePan(event: KeyboardEvent) {
      if (event.code !== "Space" || isEditingText(event.target)) {
        return;
      }

      event.preventDefault();
      spacePressedRef.current = true;
      setSpacePanReady(true);
    }

    function stopSpacePan(event: KeyboardEvent) {
      if (event.code !== "Space") {
        return;
      }

      spacePressedRef.current = false;
      setSpacePanReady(false);
    }

    function cancelSpacePan() {
      spacePressedRef.current = false;
      setSpacePanReady(false);
    }

    window.addEventListener("keydown", startSpacePan);
    window.addEventListener("keyup", stopSpacePan);
    window.addEventListener("blur", cancelSpacePan);

    return () => {
      window.removeEventListener("keydown", startSpacePan);
      window.removeEventListener("keyup", stopSpacePan);
      window.removeEventListener("blur", cancelSpacePan);
    };
  }, []);

  useEffect(() => {
    if (!editingTextId || activeTool !== "select") {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      textInputRef.current?.focus();
      textInputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [activeTool, editingTextId]);

  useEffect(() => {
    if (!imageTeamSwapRequest) {
      return;
    }

    const selectedId = selectedItemIdRef.current;
    const selectedItem = (itemsByMapRef.current[mapId] ?? []).find(
      (item) => item.id === selectedId,
    );

    if (
      !selectedItem ||
      selectedItem.type !== "image" ||
      !selectedItem.backgroundColor
    ) {
      return;
    }

    const currentColor = selectedItem.backgroundColor.toLowerCase();
    const nextColor =
      currentColor === "#4285f4" || currentColor.includes("66 133 244")
        ? "#ff5b65"
        : "#4285f4";

    recordHistory();
    setItems((current) =>
      current.map((item) =>
        item.id === selectedId && item.type === "image"
          ? { ...item, backgroundColor: nextColor }
          : item,
      ),
    );
  }, [imageTeamSwapRequest]);

  function setItems(update: ItemsUpdate) {
    onItemsByMapChange((current) => {
      const currentItems = current[mapId] ?? [];
      const nextItems =
        typeof update === "function" ? update(currentItems) : update;

      const nextState = {
        ...current,
        [mapId]: nextItems,
      };

      itemsByMapRef.current = nextState;
      return nextState;
    });
  }

  function recordHistory() {
    const snapshot = itemsByMapRef.current;

    if (historyRef.current[historyRef.current.length - 1] === snapshot) {
      return;
    }

    historyRef.current.push(snapshot);

    if (historyRef.current.length > 100) {
      historyRef.current.shift();
    }
  }

  useEffect(() => {
    selectedItemIdRef.current = null;
    actionRef.current = null;
    activeItemIdRef.current = null;
    resizeStateRef.current = null;
    rotationStateRef.current = null;
    lastErasePointRef.current = null;
    shapeStartRef.current = null;

    setSelectedItemId(null);
    setEditingTextId(null);
    setPendingImage(null);
    if (eraserCursorElementRef.current) {
      eraserCursorElementRef.current.style.opacity = "0";
    }

    onSelectionChange(null);
  }, [mapId, onSelectionChange]);

  useEffect(() => {
    const id = selectedItemIdRef.current;

    if (textSizeGestureKey === 0 || !id || activeTool !== "select") {
      return;
    }

    const selectedText = (itemsByMapRef.current[mapId] ?? []).find(
      (item) => item.id === id && item.type === "text",
    );

    if (selectedText?.type === "text") {
      recordHistory();
    }
  }, [activeTool, mapId, textSizeGestureKey]);

  useEffect(() => {
    const id = selectedItemIdRef.current;

    if (!id || activeTool !== "select") {
      return;
    }

    const selectedText = (itemsByMapRef.current[mapId] ?? []).find(
      (item) => item.id === id && item.type === "text",
    );

    if (
      !selectedText ||
      selectedText.type !== "text" ||
      selectedText.fontSize === textSize
    ) {
      return;
    }

    setItems((current) =>
      current.map((item) =>
        item.id === id && item.type === "text"
          ? {
              ...item,
              fontSize: textSize,
              height: Math.max(item.height, textSize + 20),
            }
          : item,
      ),
    );
  }, [activeTool, mapId, textSize]);

  useEffect(() => {
    const id = selectedItemIdRef.current;

    if (shapeStyleGestureKey === 0 || !id || activeTool !== "select") {
      return;
    }

    const selectedShape = (itemsByMapRef.current[mapId] ?? []).find(
      (item) =>
        item.id === id && (item.type === "shape" || item.type === "arrow"),
    );

    if (selectedShape) {
      recordHistory();
    }
  }, [activeTool, mapId, shapeStyleGestureKey]);

  useEffect(() => {
    const id = selectedItemIdRef.current;

    if (!id || activeTool !== "select") {
      return;
    }

    const selectedShape = (itemsByMapRef.current[mapId] ?? []).find(
      (item) => item.id === id,
    );

    if (!selectedShape) {
      return;
    }

    if (selectedShape.type === "arrow") {
      if (
        selectedShape.color === activeColor &&
        selectedShape.width === strokeSize &&
        (selectedShape.opacity ?? 1) === shapeOpacity
      ) {
        return;
      }

      setItems((current) =>
        current.map((item) =>
          item.id === id && item.type === "arrow"
            ? {
                ...item,
                color: activeColor,
                width: strokeSize,
                opacity: shapeOpacity,
              }
            : item,
        ),
      );
      return;
    }

    if (selectedShape.type !== "shape") {
      return;
    }

    if (
      selectedShape.color === activeColor &&
      selectedShape.border === shapeBorder &&
      selectedShape.borderWidth === strokeSize &&
      selectedShape.opacity === shapeOpacity &&
      (selectedShape.rotation ?? 0) === shapeRotation
    ) {
      return;
    }

    setItems((current) =>
      current.map((item) =>
        item.id === id && item.type === "shape"
          ? {
              ...item,
              color: activeColor,
              border: shapeBorder,
              borderWidth: strokeSize,
              opacity: shapeOpacity,
              rotation: shapeRotation,
            }
          : item,
      ),
    );
  }, [
    activeColor,
    activeTool,
    mapId,
    shapeBorder,
    shapeOpacity,
    shapeRotation,
    strokeSize,
  ]);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const updateSize = () => {
      setSize({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    };

    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (initializedRef.current || size.width === 0 || size.height === 0) {
      return;
    }

    const padding = 48;

    const scale = Math.min(
      (size.width - padding * 2) / WORLD_WIDTH,
      (size.height - padding * 2) / WORLD_HEIGHT,
    );

    setViewport({
      scale,
      x: (size.width - WORLD_WIDTH * scale) / 2,
      y: (size.height - WORLD_HEIGHT * scale) / 2,
    });

    initializedRef.current = true;
  }, [size]);

  useEffect(() => {
    if (!imagePreset) {
      setPendingImage(null);
    }
  }, [imagePreset]);

  useEffect(() => {
    if (!imagePreset) {
      return;
    }

    let cancelled = false;
    const image = new window.Image();

    image.onload = () => {
      if (cancelled) {
        return;
      }

      const maximumSize = 180;
      const scale = Math.min(
        maximumSize / image.naturalWidth,
        maximumSize / image.naturalHeight,
        1,
      );

      setPendingImage({
        src: imagePreset.src,
        width: imagePreset.backgroundColor
          ? (imagePreset.width ?? 112)
          : image.naturalWidth * scale,
        height: imagePreset.backgroundColor
          ? (imagePreset.height ?? imagePreset.width ?? 112)
          : image.naturalHeight * scale,
        backgroundColor: imagePreset.backgroundColor,
        backgroundShape: imagePreset.backgroundShape,
      });
    };

    image.onerror = () => {
      if (!cancelled) {
        setPendingImage(null);
        onToolChange("select");
        window.alert(
          "That Phighter icon could not be loaded. Check its filename in App.tsx and public/phighters.",
        );
      }
    };

    image.src = imagePreset.src;

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [imagePreset, onToolChange]);

  function getWorldPoint(clientX: number, clientY: number): Point | null {
    const svg = svgRef.current;

    if (!svg) {
      return null;
    }

    const bounds = svg.getBoundingClientRect();

    return {
      x: (clientX - bounds.left - viewport.x) / viewport.scale,
      y: (clientY - bounds.top - viewport.y) / viewport.scale,
    };
  }

  function commitImageAt(point: Point, image: DraggedPlannerImage) {
    const id = crypto.randomUUID();

    recordHistory();
    setItems((current) => [
      ...current,
      {
        id,
        type: "image",
        x: point.x - image.width / 2,
        y: point.y - image.height / 2,
        width: image.width,
        height: image.height,
        src: image.src,
        backgroundColor: image.backgroundColor,
        backgroundShape: image.backgroundShape,
      },
    ]);

    setPendingImage(null);
    selectedItemIdRef.current = id;
    setSelectedItemId(id);
    onSelectionChange({ type: "image" });
    onToolChange("select");
  }

  function handleImageDragOver(event: ReactDragEvent<SVGSVGElement>) {
    if (event.dataTransfer.types.includes(PLANNER_IMAGE_DRAG_MIME)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  }

  function handleImageDrop(event: ReactDragEvent<SVGSVGElement>) {
    const payload = event.dataTransfer.getData(PLANNER_IMAGE_DRAG_MIME);

    if (!payload) {
      return;
    }

    event.preventDefault();

    const point = getWorldPoint(event.clientX, event.clientY);

    if (!point) {
      return;
    }

    try {
      const image = JSON.parse(payload) as Partial<DraggedPlannerImage>;

      if (
        typeof image.src !== "string" ||
        typeof image.width !== "number" ||
        typeof image.height !== "number" ||
        !Number.isFinite(image.width) ||
        !Number.isFinite(image.height) ||
        image.width <= 0 ||
        image.height <= 0
      ) {
        return;
      }

      commitImageAt(point, {
        src: image.src,
        width: Math.min(image.width, 600),
        height: Math.min(image.height, 600),
        backgroundColor:
          typeof image.backgroundColor === "string"
            ? image.backgroundColor
            : undefined,
        backgroundShape:
          image.backgroundShape === "circle" ||
          image.backgroundShape === "rounded-rect"
            ? image.backgroundShape
            : undefined,
      });
    } catch {
      // Ignore non-PHIGHTPLAN drag payloads.
    }
  }

  function moveEraserCursor(point: Point, visible = true) {
    const cursor = eraserCursorElementRef.current;

    if (!cursor) {
      return;
    }

    cursor.setAttribute("cx", String(point.x));
    cursor.setAttribute("cy", String(point.y));
    cursor.style.opacity = visible ? "1" : "0";
  }

  function eraseBetween(start: Point, end: Point) {
    const radius = eraserMode === "area" ? eraserSize / 2 : 10;

    const itemWasHit = (item: BoardItem) => {
      if (item.type === "pen") {
        if (item.points.length === 1) {
          return distanceToSegment(item.points[0], start, end) <= radius;
        }

        return item.points.slice(1).some((point, index) => {
          const previous = item.points[index];

          return (
            distanceBetweenSegments(previous, point, start, end) <=
            radius + item.width / 2
          );
        });
      }

      if (item.type === "arrow") {
        return (
          distanceBetweenSegments(item.start, item.end, start, end) <=
          radius + item.width / 2
        );
      }

      return segmentTouchesRectangle(start, end, item, radius);
    };

    setItems((current) =>
      current.flatMap((item) => {
        if (!itemWasHit(item)) {
          return [item];
        }

        if (eraserMode === "stroke" || item.type !== "pen") {
          return [];
        }

        const sampleSpacing = Math.max(2, radius / 3);
        const samples: Point[] = [];

        for (let index = 0; index < item.points.length; index += 1) {
          const point = item.points[index];

          if (index === 0) {
            samples.push(point);
            continue;
          }

          const previous = item.points[index - 1];
          const distance = Math.hypot(
            point.x - previous.x,
            point.y - previous.y,
          );
          const steps = Math.max(1, Math.ceil(distance / sampleSpacing));

          for (let step = 1; step <= steps; step += 1) {
            const progress = step / steps;

            samples.push({
              x: previous.x + (point.x - previous.x) * progress,
              y: previous.y + (point.y - previous.y) * progress,
            });
          }
        }

        const fragments: Point[][] = [];
        let fragment: Point[] = [];

        for (const point of samples) {
          const erased =
            distanceToSegment(point, start, end) <= radius + item.width / 2;

          if (erased) {
            if (fragment.length > 1) {
              fragments.push(fragment);
            }

            fragment = [];
          } else {
            fragment.push(point);
          }
        }

        if (fragment.length > 1) {
          fragments.push(fragment);
        }

        return fragments.map((points, index) => ({
          ...item,
          id: index === 0 ? item.id : crypto.randomUUID(),
          points,
        }));
      }),
    );
  }

  function selectItem(item: BoardItem) {
    selectedItemIdRef.current = item.id;
    setSelectedItemId(item.id);

    if (item.type === "text") {
      onSelectionChange({
        type: "text",
        fontSize: item.fontSize,
      });
    } else if (item.type === "image") {
      onSelectionChange({ type: "image" });
    } else if (item.type === "arrow") {
      onSelectionChange({
        type: "arrow",
        color: item.color,
        width: item.width,
        opacity: item.opacity ?? 1,
      });
    } else if (item.type === "shape") {
      onSelectionChange({
        type: "shape",
        shape: item.shape,
        color: item.color,
        border: item.border,
        borderWidth: item.borderWidth,
        opacity: item.opacity,
        rotation: item.rotation ?? 0,
      });
    } else {
      onSelectionChange({ type: item.type });
    }
  }

  function clearSelection() {
    selectedItemIdRef.current = null;
    setSelectedItemId(null);
    onSelectionChange(null);
  }

  useEffect(() => {
    function handleKeyboardShortcut(event: KeyboardEvent) {
      const target = event.target;
      const editingField =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if (
        !editingField &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "z" &&
        !event.shiftKey
      ) {
        const previous = historyRef.current.pop();

        if (!previous) {
          return;
        }

        event.preventDefault();
        itemsByMapRef.current = previous;
        onItemsByMapChange(previous);
        clearSelection();
        return;
      }

      if (
        !editingField &&
        (event.key === "Backspace" || event.key === "Delete")
      ) {
        const selectedId = selectedItemIdRef.current;

        if (!selectedId) {
          return;
        }

        event.preventDefault();
        recordHistory();

        onItemsByMapChange((current) => {
          const nextState = {
            ...current,
            [mapId]: (current[mapId] ?? []).filter(
              (item) => item.id !== selectedId,
            ),
          };

          itemsByMapRef.current = nextState;
          return nextState;
        });

        clearSelection();
      }
    }

    window.addEventListener("keydown", handleKeyboardShortcut);
    return () => window.removeEventListener("keydown", handleKeyboardShortcut);
  }, [mapId, onItemsByMapChange, onSelectionChange]);

  function startMovingItem(event: ReactPointerEvent<SVGElement>, id: string) {
    if (activeTool !== "select") {
      return;
    }

    const item = items.find((candidate) => candidate.id === id);

    if (
      !item ||
      (item.type !== "text" && item.type !== "image" && item.type !== "shape")
    ) {
      return;
    }

    const point = getWorldPoint(event.clientX, event.clientY);

    if (!point) {
      return;
    }

    event.stopPropagation();

    event.currentTarget.setPointerCapture(event.pointerId);
    recordHistory();

    selectItem(item);
    setEditingTextId(null);

    actionRef.current = "move";
    activeItemIdRef.current = id;

    dragOffsetRef.current = {
      x: point.x - item.x,
      y: point.y - item.y,
    };
  }

  function updateText(id: string, value: string) {
    setItems((current) =>
      current.map((item) => {
        if (item.id !== id || item.type !== "text") {
          return item;
        }

        return {
          ...item,
          text: value,
        };
      }),
    );
  }

  function startResizingItem(
    event: ReactPointerEvent<SVGElement>,
    item: ResizableItem,
    handle: ResizeHandle,
  ) {
    if (activeTool !== "select") {
      return;
    }

    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    recordHistory();

    selectItem(item);
    setEditingTextId(null);

    actionRef.current = "resize";
    activeItemIdRef.current = item.id;

    resizeStateRef.current = {
      id: item.id,
      handle,
      original: {
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
      },
    };
  }

  function startRotatingShape(
    event: ReactPointerEvent<SVGElement>,
    item: Extract<BoardItem, { type: "shape" }>,
  ) {
    if (activeTool !== "select" || item.shape !== "rectangle") {
      return;
    }

    const point = getWorldPoint(event.clientX, event.clientY);

    if (!point) {
      return;
    }

    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    recordHistory();
    selectItem(item);

    const center = {
      x: item.x + item.width / 2,
      y: item.y + item.height / 2,
    };
    const originalRotation = item.rotation ?? 0;

    actionRef.current = "rotate";
    activeItemIdRef.current = item.id;
    rotationStateRef.current = {
      id: item.id,
      center,
      startPointerAngle: Math.atan2(point.y - center.y, point.x - center.x),
      originalRotation,
      currentRotation: originalRotation,
    };
  }

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);

    if (spacePressedRef.current) {
      const point = getWorldPoint(event.clientX, event.clientY);

      if (!point) {
        return;
      }

      actionRef.current = "pan";
      panStartRef.current = {
        pointerX: event.clientX,
        pointerY: event.clientY,
        viewX: viewport.x,
        viewY: viewport.y,
      };

      return;
    }

    if (activeTool === "eraser") {
      const point = getWorldPoint(event.clientX, event.clientY);

      if (!point) {
        return;
      }

      actionRef.current = "erase";
      recordHistory();
      lastErasePointRef.current = point;
      moveEraserCursor(point);
      eraseBetween(point, point);
      return;
    }

    const point = getWorldPoint(event.clientX, event.clientY);

    if (!point) {
      return;
    }

    if (activeTool === "select") {
      clearSelection();
      setEditingTextId(null);
      actionRef.current = "pan";

      panStartRef.current = {
        pointerX: event.clientX,
        pointerY: event.clientY,
        viewX: viewport.x,
        viewY: viewport.y,
      };

      return;
    }

    if (activeTool === "pen") {
      const id = crypto.randomUUID();

      recordHistory();
      actionRef.current = "pen";
      activeItemIdRef.current = id;

      setItems((current) => [
        ...current,
        {
          id,
          type: "pen",
          points: [point],
          color: activeColor,
          width: strokeSize,
        },
      ]);

      return;
    }

    if (activeTool === "arrow") {
      const id = crypto.randomUUID();

      recordHistory();
      activeItemIdRef.current = id;

      if (shapeKind !== "arrow") {
        actionRef.current = "shape";
        shapeStartRef.current = point;

        setItems((current) => [
          ...current,
          {
            id,
            type: "shape",
            shape: shapeKind,
            x: point.x,
            y: point.y,
            width: 0,
            height: 0,
            color: activeColor,
            border: shapeBorder,
            borderWidth: strokeSize,
            opacity: shapeOpacity,
            rotation: shapeRotation,
          },
        ]);

        return;
      }

      actionRef.current = "arrow";

      setItems((current) => [
        ...current,
        {
          id,
          type: "arrow",
          start: point,
          end: point,
          color: activeColor,
          width: strokeSize,
          opacity: shapeOpacity,
        },
      ]);

      return;
    }

    if (activeTool === "text") {
      const id = crypto.randomUUID();
      const text = "Text";

      recordHistory();
      setItems((current) => [
        ...current,
        {
          id,
          type: "text",
          x: point.x,
          y: point.y,
          width: Math.max(160, text.length * 16 + 48),
          height: 58,
          text,
          color: activeColor,
          fontSize: textSize,
        },
      ]);

      selectedItemIdRef.current = id;
      setSelectedItemId(id);
      setEditingTextId(id);
      onSelectionChange({
        type: "text",
        fontSize: textSize,
      });
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      onToolChange("select");

      return;
    }

    if (activeTool === "image") {
      if (!pendingImage) {
        pendingUploadPointRef.current = point;
        fileInputRef.current?.click();
        return;
      }

      commitImageAt(point, pendingImage);
    }
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const hoveredWorldPoint = getWorldPoint(event.clientX, event.clientY);

    if (activeTool === "eraser" && hoveredWorldPoint) {
      moveEraserCursor(hoveredWorldPoint);
    }

    if (actionRef.current === "erase") {
      const previousPoint = lastErasePointRef.current;

      const currentPoint = hoveredWorldPoint;

      if (previousPoint && currentPoint) {
        eraseBetween(previousPoint, currentPoint);
      }

      if (currentPoint) {
        lastErasePointRef.current = currentPoint;
      }

      return;
    }

    if (actionRef.current === "pan") {
      const start = panStartRef.current;

      setViewport((current) => ({
        ...current,
        x: start.viewX + event.clientX - start.pointerX,
        y: start.viewY + event.clientY - start.pointerY,
      }));

      return;
    }

    const point = getWorldPoint(event.clientX, event.clientY);
    const activeId = activeItemIdRef.current;

    if (!point || !activeId) {
      return;
    }

    if (actionRef.current === "rotate") {
      const rotationState = rotationStateRef.current;

      if (!rotationState) {
        return;
      }

      const pointerAngle = Math.atan2(
        point.y - rotationState.center.y,
        point.x - rotationState.center.x,
      );
      const difference =
        ((pointerAngle - rotationState.startPointerAngle) * 180) / Math.PI;
      const unwrappedRotation = rotationState.originalRotation + difference;
      const nextRotation =
        ((((unwrappedRotation + 180) % 360) + 360) % 360) - 180;

      rotationState.currentRotation = nextRotation;

      setItems((current) =>
        current.map((item) =>
          item.id === rotationState.id &&
          item.type === "shape" &&
          item.shape === "rectangle"
            ? { ...item, rotation: nextRotation }
            : item,
        ),
      );

      return;
    }

    if (actionRef.current === "resize") {
      const resizeState = resizeStateRef.current;

      if (!resizeState) {
        return;
      }

      const { original, handle } = resizeState;

      const itemBeingResized = items.find((item) => item.id === resizeState.id);

      if (
        !itemBeingResized ||
        (itemBeingResized.type !== "image" &&
          itemBeingResized.type !== "text" &&
          itemBeingResized.type !== "shape")
      ) {
        return;
      }

      let newX = original.x;
      let newY = original.y;
      let newWidth = original.width;
      let newHeight = original.height;

      if (itemBeingResized.type === "shape") {
        const minimumWidth = 20;
        const minimumHeight = 20;
        const center = {
          x: original.x + original.width / 2,
          y: original.y + original.height / 2,
        };
        const angle = ((itemBeingResized.rotation ?? 0) * Math.PI) / 180;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        const pointerOffsetX = point.x - center.x;
        const pointerOffsetY = point.y - center.y;
        const localPointer = {
          x: cosine * pointerOffsetX + sine * pointerOffsetY,
          y: -sine * pointerOffsetX + cosine * pointerOffsetY,
        };
        let left = -original.width / 2;
        let right = original.width / 2;
        let top = -original.height / 2;
        let bottom = original.height / 2;

        if (handle.includes("e")) {
          right = Math.max(left + minimumWidth, localPointer.x);
        } else if (handle.includes("w")) {
          left = Math.min(right - minimumWidth, localPointer.x);
        }

        if (handle.includes("s")) {
          bottom = Math.max(top + minimumHeight, localPointer.y);
        } else if (handle.includes("n")) {
          top = Math.min(bottom - minimumHeight, localPointer.y);
        }

        newWidth = right - left;
        newHeight = bottom - top;

        const localCenterOffset = {
          x: (left + right) / 2,
          y: (top + bottom) / 2,
        };
        const nextCenter = {
          x:
            center.x +
            cosine * localCenterOffset.x -
            sine * localCenterOffset.y,
          y:
            center.y +
            sine * localCenterOffset.x +
            cosine * localCenterOffset.y,
        };

        newX = nextCenter.x - newWidth / 2;
        newY = nextCenter.y - newHeight / 2;
      } else if (itemBeingResized.type === "image") {
        const anchorX = handle.includes("w")
          ? original.x + original.width
          : original.x;

        const anchorY = handle.includes("n")
          ? original.y + original.height
          : original.y;

        const horizontalScale = Math.abs(point.x - anchorX) / original.width;
        const verticalScale = Math.abs(point.y - anchorY) / original.height;
        const minimumScale = Math.max(
          40 / original.width,
          40 / original.height,
        );
        const scale = Math.max(horizontalScale, verticalScale, minimumScale);

        newWidth = original.width * scale;
        newHeight = original.height * scale;

        if (handle.includes("w")) {
          newX = anchorX - newWidth;
        }

        if (handle.includes("n")) {
          newY = anchorY - newHeight;
        }
      } else {
        const minimumWidth = 100;
        const minimumHeight = Math.max(42, itemBeingResized.fontSize + 20);

        if (handle.includes("w")) {
          const right = original.x + original.width;
          newWidth = Math.max(minimumWidth, right - point.x);
          newX = right - newWidth;
        } else if (handle.includes("e")) {
          newWidth = Math.max(minimumWidth, point.x - original.x);
        }

        if (handle.includes("n")) {
          const bottom = original.y + original.height;
          newHeight = Math.max(minimumHeight, bottom - point.y);
          newY = bottom - newHeight;
        } else if (handle.includes("s")) {
          newHeight = Math.max(minimumHeight, point.y - original.y);
        }
      }

      setItems((current) =>
        current.map((item) => {
          if (
            item.id !== resizeState.id ||
            (item.type !== "image" &&
              item.type !== "text" &&
              item.type !== "shape")
          ) {
            return item;
          }

          return {
            ...item,
            x: newX,
            y: newY,
            width: newWidth,
            height: newHeight,
          };
        }),
      );

      return;
    }

    if (actionRef.current === "move") {
      const offset = dragOffsetRef.current;

      setItems((current) =>
        current.map((item) => {
          if (
            item.id !== activeId ||
            (item.type !== "text" &&
              item.type !== "image" &&
              item.type !== "shape")
          ) {
            return item;
          }

          return {
            ...item,
            x: point.x - offset.x,
            y: point.y - offset.y,
          };
        }),
      );

      return;
    }

    if (actionRef.current === "pen") {
      setItems((current) =>
        current.map((item) => {
          if (item.id !== activeId || item.type !== "pen") {
            return item;
          }

          return {
            ...item,
            points: [...item.points, point],
          };
        }),
      );

      return;
    }

    if (actionRef.current === "shape") {
      const start = shapeStartRef.current;

      if (!start) {
        return;
      }

      setItems((current) =>
        current.map((item) => {
          if (item.id !== activeId || item.type !== "shape") {
            return item;
          }

          return {
            ...item,
            x: Math.min(start.x, point.x),
            y: Math.min(start.y, point.y),
            width: Math.abs(point.x - start.x),
            height: Math.abs(point.y - start.y),
          };
        }),
      );

      return;
    }

    if (actionRef.current === "arrow") {
      setItems((current) =>
        current.map((item) => {
          if (item.id !== activeId || item.type !== "arrow") {
            return item;
          }

          return {
            ...item,
            end: point,
          };
        }),
      );
    }
  }

  function stopAction(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (actionRef.current === "shape" && activeItemIdRef.current) {
      const finishedId = activeItemIdRef.current;
      const finishedShape = (itemsByMapRef.current[mapId] ?? []).find(
        (item) => item.id === finishedId && item.type === "shape",
      );

      if (
        finishedShape?.type === "shape" &&
        finishedShape.width >= 3 &&
        finishedShape.height >= 3
      ) {
        selectItem(finishedShape);
        onToolChange("select");
      } else {
        setItems((current) =>
          current.filter(
            (item) => item.id !== finishedId || item.type !== "shape",
          ),
        );
      }
    }

    if (actionRef.current === "rotate" && rotationStateRef.current) {
      const rotationState = rotationStateRef.current;
      const rotatedShape = (itemsByMapRef.current[mapId] ?? []).find(
        (item) => item.id === rotationState.id && item.type === "shape",
      );

      if (rotatedShape?.type === "shape") {
        selectItem({
          ...rotatedShape,
          rotation: rotationState.currentRotation,
        });
      }
    }

    actionRef.current = null;
    resizeStateRef.current = null;
    rotationStateRef.current = null;
    activeItemIdRef.current = null;
    lastErasePointRef.current = null;
    shapeStartRef.current = null;
  }

  function handleWheel(event: ReactWheelEvent<SVGSVGElement>) {
    event.preventDefault();

    const svg = svgRef.current;

    if (!svg) {
      return;
    }

    const bounds = svg.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;

    setViewport((current) => {
      const worldX = (pointerX - current.x) / current.scale;
      const worldY = (pointerY - current.y) / current.scale;

      const multiplier = Math.exp(-event.deltaY * 0.001);

      const newScale = Math.min(Math.max(current.scale * multiplier, 0.15), 8);

      return {
        scale: newScale,
        x: pointerX - worldX * newScale,
        y: pointerY - worldY * newScale,
      };
    });
  }

  function handleImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    event.target.value = "";

    if (!file) {
      pendingUploadPointRef.current = null;
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const src = String(reader.result);
      const image = new window.Image();

      image.onload = () => {
        const maximumSize = 240;

        const scale = Math.min(
          maximumSize / image.naturalWidth,
          maximumSize / image.naturalHeight,
          1,
        );

        const uploadedImage: DraggedPlannerImage = {
          src,
          width: image.naturalWidth * scale,
          height: image.naturalHeight * scale,
        };
        const placementPoint = pendingUploadPointRef.current;

        pendingUploadPointRef.current = null;

        if (placementPoint) {
          commitImageAt(placementPoint, uploadedImage);
        } else {
          setPendingImage(uploadedImage);
        }
      };

      image.src = src;
    };

    reader.readAsDataURL(file);
  }

  return (
    <div ref={containerRef} className="planner-svg-container">
      <input
        ref={fileInputRef}
        className="hidden-file-input"
        type="file"
        accept="image/*"
        onChange={handleImageUpload}
      />

      <svg
        ref={svgRef}
        className={`planner-svg tool-${activeTool}${spacePanReady ? " space-pan-ready" : ""}`}
        width="100%"
        height="100%"
        onPointerDownCapture={(event) => {
          if (spacePressedRef.current) {
            handlePointerDown(event);
            event.stopPropagation();
          }
        }}
        onPointerDown={(event) => {
          if (!spacePressedRef.current) {
            handlePointerDown(event);
          }
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={stopAction}
        onPointerCancel={stopAction}
        onDragOver={handleImageDragOver}
        onDrop={handleImageDrop}
        onPointerLeave={() => {
          if (actionRef.current !== "erase") {
            if (eraserCursorElementRef.current) {
              eraserCursorElementRef.current.style.opacity = "0";
            }
          }
        }}
        onWheel={handleWheel}
      >
        <g
          transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}
        >
          <rect width={WORLD_WIDTH} height={WORLD_HEIGHT} fill="#111318" />

          <image
            href={mapUrl}
            width={WORLD_WIDTH}
            height={WORLD_HEIGHT}
            preserveAspectRatio="xMidYMid meet"
            pointerEvents="none"
          />

          {items.map((item) => {
            if (item.type === "pen") {
              const points = item.points
                .map((point) => `${point.x},${point.y}`)
                .join(" ");

              return (
                <g
                  key={item.id}
                  onPointerDown={(event) => {
                    if (activeTool === "select") {
                      event.stopPropagation();
                      selectItem(item);
                    }
                  }}
                >
                  {selectedItemId === item.id && activeTool === "select" && (
                    <polyline
                      points={points}
                      fill="none"
                      stroke="#4285f4"
                      strokeWidth={item.width + 3 / viewport.scale}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      pointerEvents="none"
                    />
                  )}

                  {(activeTool === "eraser" || activeTool === "select") && (
                    <polyline
                      data-board-item-id={item.id}
                      points={points}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={Math.max(item.width, 30 / viewport.scale)}
                      pointerEvents="stroke"
                    />
                  )}

                  <polyline
                    points={points}
                    fill="none"
                    stroke={item.color}
                    strokeWidth={item.width}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pointerEvents="none"
                  />
                </g>
              );
            }

            if (item.type === "arrow") {
              const dx = item.end.x - item.start.x;
              const dy = item.end.y - item.start.y;
              const length = Math.hypot(dx, dy);

              if (length < 0.01) {
                return null;
              }

              const unitX = dx / length;
              const unitY = dy / length;
              const normalX = -unitY;
              const normalY = unitX;
              const headLength = Math.min(
                length * 0.6,
                Math.max(16, item.width * 4),
              );
              const headWidth = Math.max(12, item.width * 2.7);
              const baseX = item.end.x - unitX * headLength;
              const baseY = item.end.y - unitY * headLength;
              const leftX = baseX + normalX * (headWidth / 2);
              const leftY = baseY + normalY * (headWidth / 2);
              const rightX = baseX - normalX * (headWidth / 2);
              const rightY = baseY - normalY * (headWidth / 2);
              const arrowheadPoints = `${item.end.x},${item.end.y} ${leftX},${leftY} ${rightX},${rightY}`;

              return (
                <g
                  key={item.id}
                  onPointerDown={(event) => {
                    if (activeTool === "select") {
                      event.stopPropagation();
                      selectItem(item);
                    }
                  }}
                >
                  {selectedItemId === item.id && activeTool === "select" && (
                    <line
                      x1={item.start.x}
                      y1={item.start.y}
                      x2={item.end.x}
                      y2={item.end.y}
                      stroke="#4285f4"
                      strokeWidth={item.width + 3 / viewport.scale}
                      strokeLinecap="round"
                      pointerEvents="none"
                    />
                  )}

                  {(activeTool === "eraser" || activeTool === "select") && (
                    <line
                      data-board-item-id={item.id}
                      x1={item.start.x}
                      y1={item.start.y}
                      x2={item.end.x}
                      y2={item.end.y}
                      stroke="transparent"
                      strokeWidth={Math.max(item.width, 30 / viewport.scale)}
                      pointerEvents="stroke"
                    />
                  )}

                  <line
                    x1={item.start.x}
                    y1={item.start.y}
                    x2={baseX}
                    y2={baseY}
                    stroke={item.color}
                    strokeWidth={item.width}
                    strokeLinecap="butt"
                    opacity={item.opacity ?? 1}
                    pointerEvents="none"
                  />

                  <circle
                    cx={item.start.x}
                    cy={item.start.y}
                    r={item.width / 2}
                    fill={item.color}
                    opacity={item.opacity ?? 1}
                    pointerEvents="none"
                  />

                  <polygon
                    points={arrowheadPoints}
                    fill={item.color}
                    opacity={item.opacity ?? 1}
                    pointerEvents="none"
                  />
                </g>
              );
            }

            if (item.type === "shape") {
              const interactive =
                activeTool === "select" || activeTool === "eraser";
              const selected =
                activeTool === "select" && selectedItemId === item.id;
              const selectionWidth = 2 / viewport.scale;
              const hitStrokeWidth = Math.max(
                item.borderWidth,
                24 / viewport.scale,
              );
              const rotation =
                item.shape === "rectangle" ? (item.rotation ?? 0) : 0;
              const rotationTransform = rotation
                ? `rotate(${rotation} ${item.x + item.width / 2} ${item.y + item.height / 2})`
                : undefined;
              const handleSize = 8 / viewport.scale;
              const handles: {
                handle: ResizeHandle;
                x: number;
                y: number;
              }[] = [
                { handle: "nw", x: item.x, y: item.y },
                { handle: "n", x: item.x + item.width / 2, y: item.y },
                { handle: "ne", x: item.x + item.width, y: item.y },
                {
                  handle: "e",
                  x: item.x + item.width,
                  y: item.y + item.height / 2,
                },
                {
                  handle: "se",
                  x: item.x + item.width,
                  y: item.y + item.height,
                },
                {
                  handle: "s",
                  x: item.x + item.width / 2,
                  y: item.y + item.height,
                },
                { handle: "sw", x: item.x, y: item.y + item.height },
                { handle: "w", x: item.x, y: item.y + item.height / 2 },
              ];

              return (
                <g
                  key={item.id}
                  className="movable-item"
                  onPointerDown={(event) => startMovingItem(event, item.id)}
                >
                  {item.shape === "circle" ? (
                    <>
                      <ellipse
                        data-board-item-id={item.id}
                        cx={item.x + item.width / 2}
                        cy={item.y + item.height / 2}
                        rx={item.width / 2}
                        ry={item.height / 2}
                        fill="transparent"
                        stroke="transparent"
                        strokeWidth={hitStrokeWidth}
                        pointerEvents={interactive ? "all" : "none"}
                      />
                      <ellipse
                        cx={item.x + item.width / 2}
                        cy={item.y + item.height / 2}
                        rx={item.width / 2}
                        ry={item.height / 2}
                        fill={item.color}
                        fillOpacity={item.opacity}
                        stroke={item.border ? item.color : "none"}
                        strokeWidth={item.borderWidth}
                        pointerEvents="none"
                      />
                    </>
                  ) : (
                    <g transform={rotationTransform}>
                      <rect
                        data-board-item-id={item.id}
                        x={item.x}
                        y={item.y}
                        width={item.width}
                        height={item.height}
                        rx="10"
                        fill="transparent"
                        stroke="transparent"
                        strokeWidth={hitStrokeWidth}
                        pointerEvents={interactive ? "all" : "none"}
                      />
                      <rect
                        x={item.x}
                        y={item.y}
                        width={item.width}
                        height={item.height}
                        rx="10"
                        fill={item.color}
                        fillOpacity={item.opacity}
                        stroke={item.border ? item.color : "none"}
                        strokeWidth={item.borderWidth}
                        pointerEvents="none"
                      />
                    </g>
                  )}

                  {selected && (
                    <g transform={rotationTransform}>
                      <rect
                        x={item.x - 4 / viewport.scale}
                        y={item.y - 4 / viewport.scale}
                        width={item.width + 8 / viewport.scale}
                        height={item.height + 8 / viewport.scale}
                        rx={6 / viewport.scale}
                        fill="none"
                        stroke="#4285f4"
                        strokeWidth={selectionWidth}
                        strokeDasharray={`${6 / viewport.scale} ${4 / viewport.scale}`}
                        pointerEvents="none"
                      />

                      {handles.map((handle) => (
                        <rect
                          key={handle.handle}
                          x={handle.x - handleSize / 2}
                          y={handle.y - handleSize / 2}
                          width={handleSize}
                          height={handleSize}
                          rx={1.5 / viewport.scale}
                          fill="#4285f4"
                          stroke="white"
                          strokeWidth={1 / viewport.scale}
                          pointerEvents="all"
                          style={{ cursor: resizeCursor(handle.handle) }}
                          onPointerDown={(event) =>
                            startResizingItem(event, item, handle.handle)
                          }
                        />
                      ))}

                      {item.shape === "rectangle" && (
                        <>
                          <line
                            x1={item.x + item.width / 2}
                            y1={item.y - 4 / viewport.scale}
                            x2={item.x + item.width / 2}
                            y2={item.y - 27 / viewport.scale}
                            stroke="#4285f4"
                            strokeWidth={selectionWidth}
                            pointerEvents="none"
                          />
                          <circle
                            cx={item.x + item.width / 2}
                            cy={item.y - 31 / viewport.scale}
                            r={6 / viewport.scale}
                            fill="#4285f4"
                            stroke="white"
                            strokeWidth={1 / viewport.scale}
                            pointerEvents="all"
                            style={{ cursor: "grab" }}
                            onPointerDown={(event) =>
                              startRotatingShape(event, item)
                            }
                          >
                            <title>Drag to rotate</title>
                          </circle>
                        </>
                      )}
                    </g>
                  )}
                </g>
              );
            }

            if (item.type === "text") {
              const interactive =
                activeTool === "select" || activeTool === "eraser";

              const selected = selectedItemId === item.id;
              const editing = editingTextId === item.id;
              const handleSize = 8 / viewport.scale;
              const selectionWidth = 2 / viewport.scale;
              const handles: {
                handle: ResizeHandle;
                x: number;
                y: number;
              }[] = [
                { handle: "nw", x: 0, y: 0 },
                { handle: "n", x: item.width / 2, y: 0 },
                { handle: "ne", x: item.width, y: 0 },
                { handle: "e", x: item.width, y: item.height / 2 },
                { handle: "se", x: item.width, y: item.height },
                { handle: "s", x: item.width / 2, y: item.height },
                { handle: "sw", x: 0, y: item.height },
                { handle: "w", x: 0, y: item.height / 2 },
              ];

              return (
                <g
                  key={item.id}
                  className="movable-item text-card"
                  transform={`translate(${item.x} ${item.y})`}
                  pointerEvents={interactive ? "all" : "none"}
                  onPointerDown={(event) => startMovingItem(event, item.id)}
                  onDoubleClick={(event) => {
                    if (activeTool !== "select") {
                      return;
                    }

                    event.stopPropagation();
                    actionRef.current = null;
                    activeItemIdRef.current = null;
                    recordHistory();
                    selectItem(item);
                    setEditingTextId(item.id);
                  }}
                >
                  <title>
                    Double-click to edit. Single-click to select and resize.
                  </title>

                  <defs>
                    <clipPath id={`text-clip-${item.id}`}>
                      <rect
                        x="12"
                        y="0"
                        width={Math.max(0, item.width - 12)}
                        height={item.height}
                      />
                    </clipPath>
                  </defs>

                  <rect
                    data-board-item-id={item.id}
                    width={item.width}
                    height={item.height}
                    rx="8"
                    fill="#17191e"
                    stroke={selected ? item.color : "#363a43"}
                    strokeWidth="2"
                  />

                  <rect
                    width="8"
                    height={item.height}
                    rx="4"
                    fill={item.color}
                    pointerEvents="none"
                  />

                  {editing ? (
                    <foreignObject
                      x="10"
                      y="0"
                      width={item.width - 10}
                      height={item.height}
                    >
                      <input
                        ref={textInputRef}
                        autoFocus
                        value={item.text}
                        onFocus={(event) => event.currentTarget.select()}
                        onChange={(event) =>
                          updateText(item.id, event.target.value)
                        }
                        onBlur={() => setEditingTextId(null)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.currentTarget.blur();
                          }

                          if (event.key === "Escape") {
                            setEditingTextId(null);
                          }
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                        style={{
                          width: "100%",
                          height: "100%",
                          padding: "0 15px",
                          border: "none",
                          outline: "none",
                          boxSizing: "border-box",
                          color: "#f5f5f5",
                          background: "transparent",
                          fontFamily: "Inter, system-ui, sans-serif",
                          fontSize: `${item.fontSize}px`,
                          fontWeight: "700",
                        }}
                      />
                    </foreignObject>
                  ) : (
                    <text
                      className="text-card-value"
                      x="25"
                      y={item.height / 2}
                      fill="#f5f5f5"
                      fontSize={item.fontSize}
                      fontWeight="700"
                      dominantBaseline="middle"
                      clipPath={`url(#text-clip-${item.id})`}
                      pointerEvents="none"
                    >
                      {item.text}
                    </text>
                  )}

                  {selected && activeTool === "select" && !editing && (
                    <g>
                      <rect
                        width={item.width}
                        height={item.height}
                        rx="8"
                        fill="none"
                        stroke="#4285f4"
                        strokeWidth={selectionWidth}
                        pointerEvents="none"
                      />

                      {handles.map((handle) => {
                        return (
                          <rect
                            key={handle.handle}
                            x={handle.x - handleSize / 2}
                            y={handle.y - handleSize / 2}
                            width={handleSize}
                            height={handleSize}
                            rx={1.5 / viewport.scale}
                            fill="#4285f4"
                            stroke="white"
                            strokeWidth={1 / viewport.scale}
                            pointerEvents="all"
                            style={{
                              cursor: resizeCursor(handle.handle),
                            }}
                            onPointerDown={(event) =>
                              startResizingItem(event, item, handle.handle)
                            }
                          />
                        );
                      })}
                    </g>
                  )}
                </g>
              );
            }
            const interactive =
              activeTool === "select" || activeTool === "eraser";

            const selected =
              activeTool === "select" && selectedItemId === item.id;

            const handleSize = 8 / viewport.scale;
            const selectionWidth = 2 / viewport.scale;
            const imageInset = item.backgroundColor
              ? Math.min(item.width, item.height) * 0.08
              : 0;
            const backgroundShape = item.backgroundShape ?? "circle";

            const handles: {
              handle: ResizeHandle;
              x: number;
              y: number;
            }[] = [
              { handle: "nw", x: item.x, y: item.y },
              { handle: "ne", x: item.x + item.width, y: item.y },
              { handle: "sw", x: item.x, y: item.y + item.height },
              {
                handle: "se",
                x: item.x + item.width,
                y: item.y + item.height,
              },
            ];

            return (
              <g key={item.id}>
                {item.backgroundColor && backgroundShape === "circle" && (
                  <ellipse
                    cx={item.x + item.width / 2}
                    cy={item.y + item.height / 2}
                    rx={item.width / 2}
                    ry={item.height / 2}
                    fill={item.backgroundColor}
                    fillOpacity={0.58}
                    stroke="rgb(255 255 255 / 45%)"
                    strokeWidth={2 / viewport.scale}
                    pointerEvents="none"
                  />
                )}

                {item.backgroundColor && backgroundShape === "rounded-rect" && (
                  <rect
                    x={item.x}
                    y={item.y}
                    width={item.width}
                    height={item.height}
                    rx={Math.min(item.width, item.height) * 0.22}
                    fill={item.backgroundColor}
                    fillOpacity={0.58}
                    stroke="rgb(255 255 255 / 45%)"
                    strokeWidth={2 / viewport.scale}
                    pointerEvents="none"
                  />
                )}

                <image
                  className="movable-item"
                  data-board-item-id={item.id}
                  href={item.src}
                  x={item.x + imageInset}
                  y={item.y + imageInset}
                  width={item.width - imageInset * 2}
                  height={item.height - imageInset * 2}
                  preserveAspectRatio="xMidYMid meet"
                  pointerEvents={interactive ? "all" : "none"}
                  onPointerDown={(event) => startMovingItem(event, item.id)}
                />

                {selected && (
                  <g>
                    <rect
                      x={item.x}
                      y={item.y}
                      width={item.width}
                      height={item.height}
                      fill="none"
                      stroke="#4285f4"
                      strokeWidth={selectionWidth}
                      pointerEvents="none"
                    />

                    {handles.map((handle) => {
                      return (
                        <rect
                          key={handle.handle}
                          x={handle.x - handleSize / 2}
                          y={handle.y - handleSize / 2}
                          width={handleSize}
                          height={handleSize}
                          rx={1.5 / viewport.scale}
                          fill="#4285f4"
                          stroke="white"
                          strokeWidth={1 / viewport.scale}
                          pointerEvents="all"
                          style={{
                            cursor: resizeCursor(handle.handle),
                          }}
                          onPointerDown={(event) =>
                            startResizingItem(event, item, handle.handle)
                          }
                        />
                      );
                    })}
                  </g>
                )}
              </g>
            );
          })}

          {activeTool === "eraser" && (
            <circle
              ref={eraserCursorElementRef}
              className="eraser-cursor"
              r={eraserMode === "area" ? eraserSize / 2 : 10}
              fill="rgba(255, 255, 255, 0.08)"
              stroke="#ffffff"
              strokeWidth={2 / viewport.scale}
              pointerEvents="none"
            />
          )}
        </g>
      </svg>
    </div>
  );
}
