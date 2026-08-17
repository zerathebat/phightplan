import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Check,
  ChevronDown,
  Circle,
  Download,
  Eraser,
  FolderOpen,
  Image,
  MousePointer2,
  MoveRight,
  Pipette,
  Pencil,
  Search,
  Shapes,
  Square,
  Trash2,
  Type,
  Upload,
  X,
} from "lucide-react";
import "./App.css";
import type { Tool } from "./types/planner";
import {
  PlannerCanvas,
  type EraserMode,
  type PlannerImagePreset,
  type PlannerItemsByMap,
  type PlannerSelection,
  type ShapeKind,
} from "./components/board/PlannerCanvas";

const tools: {
  id: Tool;
  label: string;
  icon: typeof MousePointer2;
}[] = [
  { id: "select", label: "Select", icon: MousePointer2 },
  { id: "pen", label: "Pen", icon: Pencil },
  { id: "arrow", label: "Shapes", icon: Shapes },
  { id: "eraser", label: "Eraser", icon: Eraser },
  { id: "text", label: "Text", icon: Type },
  { id: "image", label: "Image", icon: Image },
];

const colors = ["#ff4f64", "#4285f4", "#ffffff"];

type MapDefinition = {
  id: string;
  name: string;
  file?: string;
  url?: string;
  custom?: boolean;
};

type PhaseDefinition = {
  id: string;
  name: string;
};

type PhasesByMap = Record<string, PhaseDefinition[]>;
type SelectedPhaseIdByMap = Record<string, string>;

type PhighterDefinition = {
  id: string;
  name: string;
  file: string;
  color: string;
  role?: PhighterRole;
  abilities: {
    id: string;
    name: string;
    file: string;
    key?: string;
  }[];
};

type PhighterRole = "melee" | "ranged" | "support";
type PhighterSide = "ally" | "enemy";

const phighterRoles: { id: PhighterRole; label: string }[] = [
  { id: "melee", label: "Melee" },
  { id: "ranged", label: "Ranged" },
  { id: "support", label: "Support" },
];

const abilityKeys = ["M1", "M2", "Q", "E", "F"];
const PHIGHTER_DRAG_MIME = "application/x-phightplan-image";

// Add another object here only after its image exists in public/maps.
const defaultMaps: MapDefinition[] = [];

const defaultPhases: PhaseDefinition[] = [
  {
    id: "phase-1",
    name: "Phase 1",
  },
];

// Put each Phighter's images in public/phighters/<phighter-name>.
const phighters: PhighterDefinition[] = [
  // Example:
  // {
  //   id: "skateboard",
  //   name: "Skateboard",
  //   file: "skateboard/icon.png",
  //   color: "#ff4f64",
  //   role: "melee",
  //   abilities: [
  //     { id: "primary", name: "Primary", key: "M1", file: "skateboard/primary.png" },
  //     { id: "secondary", name: "Secondary", key: "M2", file: "skateboard/secondary.png" },
  //     { id: "q", name: "Q", key: "Q", file: "skateboard/q.png" },
  //     { id: "e", name: "E", key: "E", file: "skateboard/e.png" },
  //     { id: "f", name: "F", key: "F", file: "skateboard/f.png" },
  //   ],
  // },
];

const STORAGE_KEY = "phightplan-project-v1";

type SavedProject = {
  version: 1;
  phaseModelVersion: number;
  planName: string;
  maps: MapDefinition[];
  selectedMapId: string;
  itemsByMap: PlannerItemsByMap;
  phasesByMap: PhasesByMap;
  selectedPhaseIdByMap: SelectedPhaseIdByMap;
  // Legacy fields are accepted so older PHIGHTPLAN saves can be migrated.
  planNamesByMap?: Record<string, string>;
  phases?: PhaseDefinition[];
  selectedPhaseId?: string;
};

type HsvColor = {
  h: number;
  s: number;
  v: number;
};

function hsvToHex({ h, s, v }: HsvColor) {
  const chroma = v * s;
  const section = h / 60;
  const second = chroma * (1 - Math.abs((section % 2) - 1));
  const offset = v - chroma;
  let red = 0;
  let green = 0;
  let blue = 0;

  if (section < 1) {
    red = chroma;
    green = second;
  } else if (section < 2) {
    red = second;
    green = chroma;
  } else if (section < 3) {
    green = chroma;
    blue = second;
  } else if (section < 4) {
    green = second;
    blue = chroma;
  } else if (section < 5) {
    red = second;
    blue = chroma;
  } else {
    red = chroma;
    blue = second;
  }

  const toHex = (value: number) =>
    Math.round((value + offset) * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

function hexToHsv(hex: string): HsvColor {
  const normalized = hex.replace("#", "");
  const red = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const green = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const difference = maximum - minimum;
  let hue = 0;

  if (difference > 0) {
    if (maximum === red) {
      hue = 60 * (((green - blue) / difference) % 6);
    } else if (maximum === green) {
      hue = 60 * ((blue - red) / difference + 2);
    } else {
      hue = 60 * ((red - green) / difference + 4);
    }
  }

  return {
    h: hue < 0 ? hue + 360 : hue,
    s: maximum === 0 ? 0 : difference / maximum,
    v: maximum,
  };
}

function normalizePhaseList(value: unknown): PhaseDefinition[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const phases = value.filter(
    (phase): phase is PhaseDefinition =>
      Boolean(phase) &&
      typeof phase.id === "string" &&
      typeof phase.name === "string",
  );

  return phases.length > 0 ? phases : null;
}

function createDefaultPhasesByMap(maps: MapDefinition[]): PhasesByMap {
  return Object.fromEntries(
    maps.map((map) => [map.id, defaultPhases.map((phase) => ({ ...phase }))]),
  );
}

function createDefaultSelectedPhasesByMap(
  maps: MapDefinition[],
): SelectedPhaseIdByMap {
  return Object.fromEntries(maps.map((map) => [map.id, defaultPhases[0].id]));
}

function normalizeProject(project: Partial<SavedProject>): SavedProject | null {
  if (
    project.version !== 1 ||
    !Array.isArray(project.maps) ||
    typeof project.selectedMapId !== "string" ||
    !project.itemsByMap ||
    typeof project.itemsByMap !== "object"
  ) {
    return null;
  }

  const selectedMapId = project.maps.some(
    (map) => map.id === project.selectedMapId,
  )
    ? project.selectedMapId
    : (project.maps[0]?.id ?? "");
  const legacyPhases = normalizePhaseList(project.phases) ?? defaultPhases;
  const sourcePhasesByMap =
    project.phasesByMap && typeof project.phasesByMap === "object"
      ? project.phasesByMap
      : {};
  const sourceSelectedPhasesByMap =
    project.selectedPhaseIdByMap &&
    typeof project.selectedPhaseIdByMap === "object"
      ? project.selectedPhaseIdByMap
      : {};
  const phasesByMap: PhasesByMap = {};
  const selectedPhaseIdByMap: SelectedPhaseIdByMap = {};
  const alreadyPerMap =
    project.phaseModelVersion === 2 || project.phaseModelVersion === 4;

  for (const map of project.maps) {
    const savedMapPhases = normalizePhaseList(sourcePhasesByMap[map.id]);
    const phases = alreadyPerMap
      ? (savedMapPhases ?? defaultPhases.map((phase) => ({ ...phase })))
      : map.id === selectedMapId
        ? (savedMapPhases ?? legacyPhases.map((phase) => ({ ...phase })))
        : defaultPhases.map((phase) => ({ ...phase }));
    const requestedPhaseId =
      sourceSelectedPhasesByMap[map.id] ?? project.selectedPhaseId;

    phasesByMap[map.id] = phases;
    selectedPhaseIdByMap[map.id] = phases.some(
      (phase) => phase.id === requestedPhaseId,
    )
      ? String(requestedPhaseId)
      : phases[0].id;
  }

  const legacyMapTitles =
    project.planNamesByMap && typeof project.planNamesByMap === "object"
      ? project.planNamesByMap
      : {};
  const planName =
    typeof project.planName === "string"
      ? project.planName
      : (legacyMapTitles[selectedMapId] ??
        legacyMapTitles[project.maps[0]?.id ?? ""] ??
        "Untitled strategy");

  return {
    version: 1,
    phaseModelVersion: 4,
    planName,
    maps: project.maps as MapDefinition[],
    selectedMapId,
    itemsByMap: project.itemsByMap as PlannerItemsByMap,
    phasesByMap,
    selectedPhaseIdByMap,
  };
}

function loadSavedProject(): SavedProject | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved
      ? normalizeProject(JSON.parse(saved) as Partial<SavedProject>)
      : null;
  } catch {
    return null;
  }
}

function App() {
  const mapPickerRef = useRef<HTMLDivElement | null>(null);
  const colorPickerRef = useRef<HTMLDivElement | null>(null);
  const mapFileInputRef = useRef<HTMLInputElement | null>(null);
  const projectFileInputRef = useRef<HTMLInputElement | null>(null);
  const [initialProject] = useState<SavedProject | null>(loadSavedProject);

  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [activeColor, setActiveColor] = useState(colors[1]);
  const [customHsv, setCustomHsv] = useState<HsvColor>({
    h: 275,
    s: 0.72,
    v: 0.95,
  });
  const [usingCustomColor, setUsingCustomColor] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [strokeSize, setStrokeSize] = useState(6);
  const [shapeKind, setShapeKind] = useState<ShapeKind>("arrow");
  const [shapeBorder, setShapeBorder] = useState(true);
  const [shapeOpacity, setShapeOpacity] = useState(0.25);
  const [shapeRotation, setShapeRotation] = useState(0);
  const [textSize, setTextSize] = useState(26);
  const [eraserMode, setEraserMode] = useState<EraserMode>("stroke");
  const [eraserSize, setEraserSize] = useState(48);
  const [selection, setSelection] = useState<PlannerSelection>(null);
  const [planName, setPlanName] = useState(
    initialProject?.planName ?? "Untitled strategy",
  );
  const [maps, setMaps] = useState<MapDefinition[]>(
    initialProject?.maps.length ? initialProject.maps : defaultMaps,
  );
  const [selectedMapId, setSelectedMapId] = useState(
    initialProject?.selectedMapId ?? "",
  );
  const [itemsByMap, setItemsByMap] = useState<PlannerItemsByMap>(
    initialProject?.itemsByMap ?? {},
  );
  const [phasesByMap, setPhasesByMap] = useState<PhasesByMap>(
    initialProject?.phasesByMap ?? createDefaultPhasesByMap(defaultMaps),
  );
  const [selectedPhaseIdByMap, setSelectedPhaseIdByMap] =
    useState<SelectedPhaseIdByMap>(
      initialProject?.selectedPhaseIdByMap ??
        createDefaultSelectedPhasesByMap(defaultMaps),
    );
  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null);
  const [phaseNameDraft, setPhaseNameDraft] = useState("");
  const [mapMenuOpen, setMapMenuOpen] = useState(false);
  const [historyResetKey, setHistoryResetKey] = useState(0);
  const [textSizeGestureKey, setTextSizeGestureKey] = useState(0);
  const [shapeStyleGestureKey, setShapeStyleGestureKey] = useState(0);
  const [imagePreset, setImagePreset] = useState<PlannerImagePreset | null>(
    null,
  );
  const [selectedPhighterIds, setSelectedPhighterIds] = useState<
    Record<PhighterSide, string | null>
  >({
    ally: phighters[0]?.id ?? null,
    enemy: null,
  });
  const [phighterSide, setPhighterSide] = useState<PhighterSide>("ally");
  const [phighterSearch, setPhighterSearch] = useState("");
  const [saveStatus, setSaveStatus] = useState<"saving" | "saved" | "failed">(
    "saved",
  );

  const selectedMap = maps.find((map) => map.id === selectedMapId) ?? null;

  const mapUrl =
    selectedMap?.url ??
    (selectedMap
      ? `${import.meta.env.BASE_URL}maps/${selectedMap.file ?? ""}`
      : "");

  const customColor = hsvToHex(customHsv);
  const phases = selectedMap
    ? (phasesByMap[selectedMap.id] ?? defaultPhases)
    : [];
  const requestedPhaseId = selectedMap
    ? selectedPhaseIdByMap[selectedMap.id]
    : undefined;
  const selectedPhaseId =
    phases.find((phase) => phase.id === requestedPhaseId)?.id ??
    phases[0]?.id ??
    "";

  // Keep the original map key for Phase 1 so older local saves still appear.
  const boardId =
    selectedMap && selectedPhaseId === defaultPhases[0].id
      ? selectedMap.id
      : selectedMap
        ? `${selectedMap.id}::${selectedPhaseId}`
        : "";

  const selectedShape =
    activeTool === "select" &&
    (selection?.type === "shape" || selection?.type === "arrow");
  const drawingTool =
    activeTool === "pen" || activeTool === "arrow" || selectedShape;
  const showShapeSettings = activeTool === "arrow" || selectedShape;
  const showTextSize =
    activeTool === "text" ||
    (activeTool === "select" && selection?.type === "text");
  const selectedPhighterId = selectedPhighterIds[phighterSide];
  const selectedPhighter =
    phighters.find((phighter) => phighter.id === selectedPhighterId) ?? null;
  const normalizedPhighterSearch = phighterSearch.trim().toLowerCase();
  const filteredPhighters = phighters.filter((phighter) =>
    phighter.name.toLowerCase().includes(normalizedPhighterSearch),
  );
  const groupedPhighters = phighterRoles
    .map((role) => ({
      ...role,
      phighters: filteredPhighters.filter(
        (phighter) => (phighter.role ?? "melee") === role.id,
      ),
    }))
    .filter((group) => group.phighters.length > 0);
  const abilitySlots = Array.from(
    { length: 5 },
    (_, index) => selectedPhighter?.abilities[index] ?? null,
  );

  const phighterTokenColor = phighterSide === "ally" ? "#4285f4" : "#ff5b65";

  function placePlannerImage(src: string, backgroundColor?: string) {
    if (!selectedMap) {
      return;
    }

    setImagePreset({
      requestId: crypto.randomUUID(),
      src,
      backgroundColor,
    });
    setActiveTool("image");
  }

  function startPlannerImageDrag(
    event: ReactDragEvent<HTMLElement>,
    src: string,
    options?: {
      backgroundColor?: string;
      size?: number;
    },
  ) {
    if (!selectedMap) {
      event.preventDefault();
      return;
    }

    const size = options?.size ?? 96;

    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(
      PHIGHTER_DRAG_MIME,
      JSON.stringify({
        src,
        width: size,
        height: size,
        backgroundColor: options?.backgroundColor,
      }),
    );
  }

  function selectPhighter(phighterId: string | null) {
    setSelectedPhighterIds((current) => ({
      ...current,
      [phighterSide]: phighterId,
    }));
  }

  const applyProject = useCallback((project: SavedProject) => {
    setPlanName(project.planName);
    setMaps(project.maps);
    setSelectedMapId(project.selectedMapId);
    setItemsByMap(project.itemsByMap);
    setPhasesByMap(project.phasesByMap);
    setSelectedPhaseIdByMap(project.selectedPhaseIdByMap);
    setEditingPhaseId(null);
    setPhaseNameDraft("");
    setImagePreset(null);
    setSelection(null);
    setActiveTool("select");
    setHistoryResetKey((current) => current + 1);
  }, []);

  useEffect(() => {
    function closeMapMenu(event: PointerEvent) {
      if (!mapPickerRef.current?.contains(event.target as Node)) {
        setMapMenuOpen(false);
      }

      if (!colorPickerRef.current?.contains(event.target as Node)) {
        setColorPickerOpen(false);
      }
    }

    function closeMapMenuWithEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMapMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeMapMenu);
    document.addEventListener("keydown", closeMapMenuWithEscape);

    return () => {
      document.removeEventListener("pointerdown", closeMapMenu);
      document.removeEventListener("keydown", closeMapMenuWithEscape);
    };
  }, []);

  useEffect(() => {
    if (!drawingTool) {
      setColorPickerOpen(false);
    }
  }, [drawingTool]);

  useEffect(() => {
    let favicon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');

    if (!favicon) {
      favicon = document.createElement("link");
      favicon.rel = "icon";
      document.head.append(favicon);
    }

    favicon.type = "image/png";
    favicon.href = `${import.meta.env.BASE_URL}phightplan-icon.png`;
    document.title = "PHIGHTPLAN";
  }, []);

  useEffect(() => {
    setSaveStatus("saving");

    const timeout = window.setTimeout(() => {
      const project: SavedProject = {
        version: 1,
        phaseModelVersion: 4,
        planName,
        maps,
        selectedMapId,
        itemsByMap,
        phasesByMap,
        selectedPhaseIdByMap,
      };

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
        setSaveStatus("saved");
      } catch {
        setSaveStatus("failed");
      }
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [
    itemsByMap,
    maps,
    phasesByMap,
    planName,
    selectedMapId,
    selectedPhaseIdByMap,
  ]);

  const handleSelectionChange = useCallback(
    (nextSelection: PlannerSelection) => {
      setSelection(nextSelection);

      if (nextSelection?.type === "text") {
        setTextSize(nextSelection.fontSize);
      } else if (
        nextSelection?.type === "shape" ||
        nextSelection?.type === "arrow"
      ) {
        const nextColor = nextSelection.color.toLowerCase();

        setActiveColor(nextColor);
        setStrokeSize(
          nextSelection.type === "shape"
            ? nextSelection.borderWidth
            : nextSelection.width,
        );
        setShapeOpacity(nextSelection.opacity);
        setShapeKind(
          nextSelection.type === "shape" ? nextSelection.shape : "arrow",
        );

        if (nextSelection.type === "shape") {
          setShapeBorder(nextSelection.border);
          setShapeRotation(nextSelection.rotation);
        }

        if (colors.includes(nextColor)) {
          setUsingCustomColor(false);
        } else {
          setUsingCustomColor(true);
          setCustomHsv(hexToHsv(nextColor));
        }
      }
    },
    [],
  );

  function beginShapeStyleGesture() {
    if (selectedShape) {
      setShapeStyleGestureKey((current) => current + 1);
    }
  }

  function applyCustomColor(nextColor: HsvColor) {
    setCustomHsv(nextColor);
    setUsingCustomColor(true);
    setActiveColor(hsvToHex(nextColor));
  }

  function updateSaturationAndValue(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const saturation = Math.max(
      0,
      Math.min(1, (event.clientX - bounds.left) / bounds.width),
    );
    const value = Math.max(
      0,
      Math.min(1, 1 - (event.clientY - bounds.top) / bounds.height),
    );

    applyCustomColor({
      ...customHsv,
      s: saturation,
      v: value,
    });
  }

  function handleMapImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    event.target.value = "";

    if (!file) {
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const id = `custom-${crypto.randomUUID()}`;
      const name = file.name.replace(/\.[^.]+$/, "");

      setMaps((current) => [
        ...current,
        {
          id,
          name,
          url: String(reader.result),
          custom: true,
        },
      ]);
      setPhasesByMap((current) => ({
        ...current,
        [id]: defaultPhases.map((phase) => ({ ...phase })),
      }));
      setSelectedPhaseIdByMap((current) => ({
        ...current,
        [id]: defaultPhases[0].id,
      }));

      setSelectedMapId(id);
      setImagePreset(null);
      setActiveTool("select");
      setMapMenuOpen(false);
    };

    reader.readAsDataURL(file);
  }

  function deleteMap(mapId: string) {
    const map = maps.find((candidate) => candidate.id === mapId);

    if (
      !map ||
      !window.confirm(
        `Delete ${map.name}? Its annotations will also be deleted.`,
      )
    ) {
      return;
    }

    const mapIndex = maps.findIndex((candidate) => candidate.id === mapId);
    const remainingMaps = maps.filter((candidate) => candidate.id !== mapId);

    setMaps(remainingMaps);
    setPhasesByMap((current) => {
      const next = { ...current };
      delete next[mapId];
      return next;
    });
    setSelectedPhaseIdByMap((current) => {
      const next = { ...current };
      delete next[mapId];
      return next;
    });

    if (selectedMapId === mapId) {
      const nextMap =
        remainingMaps[Math.min(mapIndex, remainingMaps.length - 1)] ?? null;
      setSelectedMapId(nextMap?.id ?? "");
    }

    setItemsByMap((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([key]) => key !== mapId && !key.startsWith(`${mapId}::`),
        ),
      ),
    );
    setEditingPhaseId(null);
    setPhaseNameDraft("");
    setImagePreset(null);
    setSelection(null);
    setActiveTool("select");
  }

  function exportProject() {
    const project: SavedProject = {
      version: 1,
      phaseModelVersion: 4,
      planName,
      maps,
      selectedMapId,
      itemsByMap,
      phasesByMap,
      selectedPhaseIdByMap,
    };

    const blob = new Blob([JSON.stringify(project, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeName =
      planName
        .trim()
        .replace(/[^a-z0-9_-]+/gi, "-")
        .replace(/^-|-$/g, "") || "phightplan";

    link.href = url;
    link.download = `${safeName}.phightplan.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function importProject(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      const imported = normalizeProject(
        JSON.parse(await file.text()) as Partial<SavedProject>,
      );

      if (!imported) {
        throw new Error("Invalid PHIGHTPLAN file");
      }

      applyProject(imported);
    } catch {
      window.alert("That file is not a valid PHIGHTPLAN project.");
    }
  }

  function addPhase() {
    if (!selectedMap) {
      return;
    }

    const phase: PhaseDefinition = {
      id: `phase-${crypto.randomUUID()}`,
      name: `Phase ${phases.length + 1}`,
    };

    setPhasesByMap((current) => ({
      ...current,
      [selectedMap.id]: [...(current[selectedMap.id] ?? defaultPhases), phase],
    }));
    setSelectedPhaseIdByMap((current) => ({
      ...current,
      [selectedMap.id]: phase.id,
    }));
    setEditingPhaseId(phase.id);
    setPhaseNameDraft(phase.name);
    setImagePreset(null);
    setSelection(null);
    setActiveTool("select");
  }

  function startRenamingPhase(phase: PhaseDefinition) {
    if (!selectedMap) {
      return;
    }

    setSelectedPhaseIdByMap((current) => ({
      ...current,
      [selectedMap.id]: phase.id,
    }));
    setEditingPhaseId(phase.id);
    setPhaseNameDraft(phase.name);
  }

  function finishRenamingPhase() {
    if (!editingPhaseId || !selectedMap) {
      return;
    }

    const nextName = phaseNameDraft.trim() || "Untitled phase";

    setPhasesByMap((current) => ({
      ...current,
      [selectedMap.id]: (current[selectedMap.id] ?? defaultPhases).map(
        (phase) =>
          phase.id === editingPhaseId ? { ...phase, name: nextName } : phase,
      ),
    }));
    setEditingPhaseId(null);
    setPhaseNameDraft("");
  }

  function cancelRenamingPhase() {
    setEditingPhaseId(null);
    setPhaseNameDraft("");
  }

  function deletePhase(phase: PhaseDefinition) {
    if (!selectedMap) {
      return;
    }

    if (phases.length <= 1) {
      window.alert("A map must have at least one phase.");
      return;
    }

    if (
      !window.confirm(
        `Delete ${phase.name}? Its annotations on ${selectedMap.name} will also be deleted.`,
      )
    ) {
      return;
    }

    const phaseIndex = phases.findIndex(
      (candidate) => candidate.id === phase.id,
    );
    const remainingPhases = phases.filter(
      (candidate) => candidate.id !== phase.id,
    );
    const nextSelectedPhase =
      selectedPhaseId === phase.id
        ? remainingPhases[Math.min(phaseIndex, remainingPhases.length - 1)]?.id
        : selectedPhaseId;
    setPhasesByMap((current) => ({
      ...current,
      [selectedMap.id]: remainingPhases,
    }));
    setSelectedPhaseIdByMap((current) => ({
      ...current,
      [selectedMap.id]: nextSelectedPhase ?? remainingPhases[0].id,
    }));
    setItemsByMap((current) => {
      const next = { ...current };
      const phaseBoardId =
        phase.id === defaultPhases[0].id
          ? selectedMap.id
          : `${selectedMap.id}::${phase.id}`;
      delete next[phaseBoardId];

      return next;
    });

    if (editingPhaseId === phase.id) {
      cancelRenamingPhase();
    }

    setSelection(null);
    setActiveTool("select");
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <div className="logo" aria-label="PHIGHTPLAN">
            <img
              src={`${import.meta.env.BASE_URL}phightplan-icon.png`}
              alt="PHIGHTPLAN"
            />
          </div>

          <div ref={mapPickerRef} className="map-picker">
            <button
              className="map-picker-trigger"
              type="button"
              aria-haspopup="listbox"
              aria-expanded={mapMenuOpen}
              onClick={() => setMapMenuOpen((open) => !open)}
            >
              <span
                className={selectedMap ? "map-preview" : "map-preview empty"}
              >
                {selectedMap ? <img src={mapUrl} alt="" /> : <span>—</span>}
              </span>

              <span className="map-picker-copy">
                <small>MAP</small>
                <strong>{selectedMap?.name ?? "NO MAP SELECTED"}</strong>
              </span>

              <ChevronDown
                className={mapMenuOpen ? "map-chevron open" : "map-chevron"}
                size={18}
              />
            </button>

            <input
              ref={mapFileInputRef}
              className="hidden-file-input"
              type="file"
              accept=".svg,image/svg+xml,image/png,image/jpeg,image/webp"
              onChange={handleMapImport}
            />

            {mapMenuOpen && (
              <div className="map-menu" role="listbox" aria-label="Maps">
                {maps.map((map) => {
                  const selected = map.id === selectedMapId;
                  const previewUrl =
                    map.url ??
                    `${import.meta.env.BASE_URL}maps/${map.file ?? ""}`;

                  return (
                    <div
                      key={map.id}
                      className={
                        selected ? "map-option selected" : "map-option"
                      }
                      role="option"
                      aria-selected={selected}
                    >
                      <button
                        className="map-option-select"
                        type="button"
                        onClick={() => {
                          setSelectedMapId(map.id);
                          setEditingPhaseId(null);
                          setPhaseNameDraft("");
                          setImagePreset(null);
                          setActiveTool("select");
                          setMapMenuOpen(false);
                        }}
                      >
                        <span className="map-option-preview">
                          <img src={previewUrl} alt="" />
                        </span>

                        <span className="map-option-name">
                          {map.name}
                          {map.custom && <small>Imported</small>}
                        </span>
                        {selected && <Check size={17} />}
                      </button>

                      <button
                        className="map-delete-button"
                        type="button"
                        title={`Delete ${map.name}`}
                        aria-label={`Delete ${map.name}`}
                        onClick={() => deleteMap(map.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  );
                })}

                <button
                  className="map-import-button"
                  type="button"
                  onClick={() => mapFileInputRef.current?.click()}
                >
                  <Upload size={18} />
                  <span>
                    <strong>Import your own map</strong>
                    <small>SVG, PNG, JPG or WebP</small>
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>

        <input
          className="plan-name"
          value={planName}
          onChange={(event) => setPlanName(event.target.value)}
          aria-label="Strategy name"
        />

        <div className="topbar-right">
          <span className={`save-status ${saveStatus}`}>
            {saveStatus === "saving"
              ? "Saving…"
              : saveStatus === "failed"
                ? "Save failed"
                : "Saved!"}
          </span>

          <input
            ref={projectFileInputRef}
            className="hidden-file-input"
            type="file"
            accept=".json,.phightplan,application/json"
            onChange={importProject}
          />

          <button
            className="header-action-button"
            type="button"
            onClick={() => projectFileInputRef.current?.click()}
          >
            <FolderOpen size={17} />
            Import
          </button>

          <button
            className="export-button"
            type="button"
            onClick={exportProject}
          >
            <Download size={17} />
            Export
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="board">
          {selectedMap ? (
            <PlannerCanvas
              activeTool={activeTool}
              activeColor={activeColor}
              strokeSize={strokeSize}
              shapeKind={shapeKind}
              shapeBorder={shapeBorder}
              shapeOpacity={shapeOpacity}
              shapeRotation={shapeRotation}
              textSize={textSize}
              eraserMode={eraserMode}
              eraserSize={eraserSize}
              mapId={boardId}
              mapUrl={mapUrl}
              itemsByMap={itemsByMap}
              onItemsByMapChange={setItemsByMap}
              historyResetKey={historyResetKey}
              textSizeGestureKey={textSizeGestureKey}
              shapeStyleGestureKey={shapeStyleGestureKey}
              imagePreset={imagePreset}
              onToolChange={setActiveTool}
              onSelectionChange={handleSelectionChange}
            />
          ) : (
            <div className="no-map-selected">NO MAP SELECTED</div>
          )}

          {selectedMap && (
            <div className="phase-bar">
              <div className="phase-list">
                {phases.map((phase) => (
                  <div key={phase.id} className="phase-item">
                    {editingPhaseId === phase.id ? (
                      <input
                        className="phase-name-input"
                        value={phaseNameDraft}
                        autoFocus
                        aria-label="Phase name"
                        onChange={(event) =>
                          setPhaseNameDraft(event.target.value)
                        }
                        onBlur={finishRenamingPhase}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.currentTarget.blur();
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            cancelRenamingPhase();
                          }
                        }}
                      />
                    ) : (
                      <button
                        className={
                          selectedPhaseId === phase.id
                            ? "phase active"
                            : "phase"
                        }
                        type="button"
                        title="Double-click to rename"
                        onClick={() => {
                          setSelectedPhaseIdByMap((current) => ({
                            ...current,
                            [selectedMap.id]: phase.id,
                          }));
                          setImagePreset(null);
                          setActiveTool("select");
                          setSelection(null);
                        }}
                        onDoubleClick={() => startRenamingPhase(phase)}
                      >
                        {phase.name}
                      </button>
                    )}

                    <button
                      className="phase-delete-button"
                      type="button"
                      title={
                        phases.length <= 1
                          ? "A map needs at least one phase"
                          : `Delete ${phase.name}`
                      }
                      aria-label={`Delete ${phase.name}`}
                      disabled={phases.length <= 1}
                      onClick={() => deletePhase(phase)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                className="add-phase"
                type="button"
                aria-label="Add phase"
                title="Add phase"
                onClick={addPhase}
              >
                +
              </button>
            </div>
          )}
        </section>

        <aside className="sidebar">
          <section className="sidebar-section">
            <h2>Tools</h2>

            <div className="tool-grid">
              {tools.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  className={
                    activeTool === id ? "tool-button active" : "tool-button"
                  }
                  type="button"
                  disabled={!selectedMap}
                  onClick={() => {
                    setImagePreset(null);
                    if (id === "arrow") {
                      setShapeRotation(0);
                    }
                    setActiveTool(id);
                  }}
                  title={label}
                  aria-label={label}
                >
                  <Icon size={22} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </section>

          {drawingTool && (
            <section
              className={
                showShapeSettings && shapeKind !== "arrow"
                  ? "sidebar-section drawing-settings color-only"
                  : "sidebar-section drawing-settings"
              }
            >
              <div className="setting-column color-setting">
                <h2>Color</h2>

                <div ref={colorPickerRef} className="color-list">
                  {colors.map((color) => (
                    <button
                      key={color}
                      className={
                        !usingCustomColor && activeColor === color
                          ? "color-button active"
                          : "color-button"
                      }
                      type="button"
                      style={{ backgroundColor: color }}
                      onClick={() => {
                        beginShapeStyleGesture();
                        setUsingCustomColor(false);
                        setActiveColor(color);
                        setColorPickerOpen(false);
                      }}
                      aria-label={`Select ${color}`}
                    />
                  ))}

                  <button
                    className={
                      usingCustomColor
                        ? "color-button custom-color-button active"
                        : "color-button custom-color-button"
                    }
                    type="button"
                    style={{ backgroundColor: customColor }}
                    aria-label="Choose custom color"
                    aria-expanded={colorPickerOpen}
                    onClick={() => {
                      beginShapeStyleGesture();
                      setUsingCustomColor(true);
                      setActiveColor(customColor);
                      setColorPickerOpen((open) => !open);
                    }}
                  >
                    <Pipette size={11} />
                  </button>

                  {colorPickerOpen && (
                    <div className="color-picker-popover">
                      <div
                        className="saturation-value-picker"
                        style={{
                          backgroundColor: `hsl(${customHsv.h} 100% 50%)`,
                        }}
                        onPointerDown={(event) => {
                          beginShapeStyleGesture();
                          event.currentTarget.setPointerCapture(
                            event.pointerId,
                          );
                          updateSaturationAndValue(event);
                        }}
                        onPointerMove={(event) => {
                          if (
                            event.currentTarget.hasPointerCapture(
                              event.pointerId,
                            )
                          ) {
                            updateSaturationAndValue(event);
                          }
                        }}
                        onPointerUp={(event) =>
                          event.currentTarget.releasePointerCapture(
                            event.pointerId,
                          )
                        }
                      >
                        <span
                          className="color-picker-handle"
                          style={{
                            left: `${customHsv.s * 100}%`,
                            top: `${(1 - customHsv.v) * 100}%`,
                            backgroundColor: customColor,
                          }}
                        />
                      </div>

                      <input
                        className="hue-slider"
                        type="range"
                        min="0"
                        max="359"
                        step="1"
                        value={customHsv.h}
                        aria-label="Custom color hue"
                        onPointerDown={beginShapeStyleGesture}
                        onChange={(event) =>
                          applyCustomColor({
                            ...customHsv,
                            h: Number(event.target.value),
                          })
                        }
                      />

                      <output className="custom-color-value">
                        {customColor.toUpperCase()}
                      </output>
                    </div>
                  )}
                </div>
              </div>

              {(!showShapeSettings || shapeKind === "arrow") && (
                <div className="setting-column width-setting">
                  <div className="setting-heading">
                    <h2>Width</h2>
                  </div>

                  <div className="slider-row">
                    <input
                      className="size-slider"
                      type="range"
                      min="2"
                      max="24"
                      step="1"
                      value={strokeSize}
                      onPointerDown={beginShapeStyleGesture}
                      onChange={(event) =>
                        setStrokeSize(Number(event.target.value))
                      }
                      aria-label="Stroke width"
                    />
                    <output className="slider-value">{strokeSize}px</output>
                  </div>
                </div>
              )}
            </section>
          )}

          {showShapeSettings && (
            <section className="sidebar-section shape-settings">
              <h2>{selectedShape ? `Selected ${shapeKind}` : "Shape"}</h2>

              {activeTool === "arrow" && (
                <div
                  className="segmented-control shape-kind-control"
                  aria-label="Shape type"
                >
                  {(
                    [
                      { id: "arrow", label: "Arrow", icon: MoveRight },
                      { id: "circle", label: "Circle", icon: Circle },
                      { id: "rectangle", label: "Rectangle", icon: Square },
                    ] as const
                  ).map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      className={shapeKind === id ? "active" : ""}
                      type="button"
                      onClick={() => setShapeKind(id)}
                    >
                      <Icon size={15} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              )}

              {shapeKind !== "arrow" && (
                <>
                  <div className="shape-border-row">
                    <span>Border</span>
                    <button
                      className={
                        shapeBorder ? "toggle-switch active" : "toggle-switch"
                      }
                      type="button"
                      role="switch"
                      aria-checked={shapeBorder}
                      onClick={() => {
                        beginShapeStyleGesture();
                        setShapeBorder((enabled) => !enabled);
                      }}
                    >
                      <span />
                    </button>
                  </div>

                  <div className="setting-heading shape-attribute-heading">
                    <span>Border width</span>
                  </div>

                  <div className="slider-row">
                    <input
                      className="size-slider"
                      type="range"
                      min="1"
                      max="24"
                      step="1"
                      value={strokeSize}
                      onPointerDown={beginShapeStyleGesture}
                      onChange={(event) =>
                        setStrokeSize(Number(event.target.value))
                      }
                      aria-label="Shape border width"
                    />
                    <output className="slider-value">{strokeSize}px</output>
                  </div>
                </>
              )}

              <div className="setting-heading shape-opacity-heading">
                <span>
                  {shapeKind === "arrow" ? "Opacity" : "Fill opacity"}
                </span>
              </div>

              <div className="slider-row">
                <input
                  className="size-slider"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(shapeOpacity * 100)}
                  onPointerDown={beginShapeStyleGesture}
                  onChange={(event) =>
                    setShapeOpacity(Number(event.target.value) / 100)
                  }
                  aria-label="Shape opacity"
                />
                <output className="slider-value">
                  {Math.round(shapeOpacity * 100)}%
                </output>
              </div>
            </section>
          )}

          {showTextSize && (
            <section className="sidebar-section">
              <div className="setting-heading">
                <h2>Text size</h2>
              </div>

              <div className="slider-row">
                <input
                  className="size-slider"
                  type="range"
                  min="12"
                  max="72"
                  step="1"
                  value={textSize}
                  onPointerDown={() =>
                    setTextSizeGestureKey((current) => current + 1)
                  }
                  onFocus={() =>
                    setTextSizeGestureKey((current) => current + 1)
                  }
                  onChange={(event) => setTextSize(Number(event.target.value))}
                  aria-label="Text size"
                />
                <output className="slider-value">{textSize}px</output>
              </div>
            </section>
          )}

          {activeTool === "eraser" && (
            <section className="sidebar-section eraser-settings">
              <h2>Eraser</h2>

              <div className="segmented-control" aria-label="Eraser mode">
                <button
                  className={eraserMode === "stroke" ? "active" : ""}
                  type="button"
                  onClick={() => setEraserMode("stroke")}
                >
                  Stroke
                </button>
                <button
                  className={eraserMode === "area" ? "active" : ""}
                  type="button"
                  onClick={() => setEraserMode("area")}
                >
                  Area
                </button>
              </div>

              {eraserMode === "area" && (
                <>
                  <div className="setting-heading eraser-size-heading">
                    <span>Size</span>
                  </div>

                  <div className="slider-row">
                    <input
                      className="size-slider"
                      type="range"
                      min="12"
                      max="140"
                      step="2"
                      value={eraserSize}
                      onChange={(event) =>
                        setEraserSize(Number(event.target.value))
                      }
                      aria-label="Eraser size"
                    />
                    <output className="slider-value">{eraserSize}px</output>
                  </div>
                </>
              )}
            </section>
          )}

          <section className="sidebar-section phighter-roster-section">
            <div className="phighter-panel-heading">
              <h2>Phighters</h2>
            </div>

            <div className="phighter-team-tabs" aria-label="Phighter side">
              <button
                className={phighterSide === "ally" ? "active" : ""}
                type="button"
                aria-pressed={phighterSide === "ally"}
                onClick={() => setPhighterSide("ally")}
              >
                <span className="team-dot ally" />
                Ally
              </button>
              <button
                className={phighterSide === "enemy" ? "active" : ""}
                type="button"
                aria-pressed={phighterSide === "enemy"}
                onClick={() => setPhighterSide("enemy")}
              >
                <span className="team-dot enemy" />
                Enemy
              </button>
            </div>

            <label className="phighter-search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={phighterSearch}
                placeholder="Find a Phighter"
                aria-label="Find a Phighter"
                onChange={(event) => setPhighterSearch(event.target.value)}
              />
            </label>

            <p className="phighter-help">Select a Phighter or tap + to place</p>

            <div className="phighter-roster" aria-label="Phighter roster">
              {groupedPhighters.map((group) => (
                <div className="phighter-role-group" key={group.id}>
                  <div className="phighter-role-heading">
                    <span>{group.label}</span>
                    <span>{group.phighters.length}</span>
                    <i />
                  </div>

                  <div className="phighter-list">
                    {group.phighters.map((phighter) => {
                      const src = `${import.meta.env.BASE_URL}phighters/${phighter.file}`;
                      const selected = selectedPhighterId === phighter.id;

                      return (
                        <div
                          className={
                            selected ? "phighter-row active" : "phighter-row"
                          }
                          key={phighter.id}
                          draggable={Boolean(selectedMap)}
                          style={{ borderColor: phighter.color }}
                          onDragStart={(event) => {
                            selectPhighter(phighter.id);
                            startPlannerImageDrag(event, src, {
                              backgroundColor: phighterTokenColor,
                              size: 112,
                            });
                          }}
                        >
                          <button
                            className="phighter-row-main"
                            type="button"
                            aria-pressed={selected}
                            onClick={() => selectPhighter(phighter.id)}
                          >
                            <span
                              className="phighter-portrait"
                              style={{
                                borderColor: phighter.color,
                                backgroundColor: phighterTokenColor,
                              }}
                            >
                              <img src={src} alt="" draggable={false} />
                            </span>
                            <span className="phighter-row-copy">
                              <strong>{phighter.name}</strong>
                              <small>{phighter.role ?? "melee"}</small>
                            </span>
                          </button>

                          <button
                            className="phighter-row-place"
                            type="button"
                            disabled={!selectedMap}
                            title={`Place ${phighter.name}`}
                            aria-label={`Place ${phighter.name}`}
                            onClick={() => {
                              selectPhighter(phighter.id);
                              placePlannerImage(src, phighterTokenColor);
                            }}
                          >
                            +
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {groupedPhighters.length === 0 && (
                <div className="phighter-empty-state">
                  {phighters.length === 0
                    ? "Add Phighters to the array in App.tsx."
                    : "No Phighters match that search."}
                </div>
              )}
            </div>

            <div className="selected-phighter-panel">
              <div className="selected-phighter-summary">
                {selectedPhighter ? (
                  <>
                    <span
                      className="selected-phighter-portrait"
                      style={{
                        borderColor: selectedPhighter.color,
                        backgroundColor: phighterTokenColor,
                      }}
                    >
                      <img
                        src={`${import.meta.env.BASE_URL}phighters/${selectedPhighter.file}`}
                        alt=""
                        draggable={false}
                      />
                    </span>

                    <span className="selected-phighter-copy">
                      <small>Selected</small>
                      <strong>{selectedPhighter.name}</strong>
                      <span>
                        {phighterSide} / {selectedPhighter.role ?? "melee"}
                      </span>
                    </span>

                    <button
                      className="place-phighter-button"
                      type="button"
                      disabled={!selectedMap}
                      onClick={() =>
                        placePlannerImage(
                          `${import.meta.env.BASE_URL}phighters/${selectedPhighter.file}`,
                          phighterTokenColor,
                        )
                      }
                    >
                      Place
                    </button>

                    <button
                      className="clear-phighter-button"
                      type="button"
                      title="Clear selected Phighter"
                      aria-label="Clear selected Phighter"
                      onClick={() => selectPhighter(null)}
                    >
                      <X size={18} />
                    </button>
                  </>
                ) : (
                  <p>Select a Phighter to show their abilities.</p>
                )}
              </div>

              <div className="ability-grid" aria-label="Phighter abilities">
                {abilitySlots.map((ability, index) => {
                  if (!ability || !selectedPhighter) {
                    return (
                      <div
                        key={`ability-slot-${index}`}
                        className="ability-button ability-placeholder"
                        aria-hidden="true"
                      >
                        <span>{abilityKeys[index]}</span>
                      </div>
                    );
                  }

                  const src = `${import.meta.env.BASE_URL}phighters/${ability.file}`;

                  return (
                    <button
                      key={ability.id}
                      className="ability-button"
                      type="button"
                      disabled={!selectedMap}
                      draggable={Boolean(selectedMap)}
                      title={`Place ${selectedPhighter.name} ${ability.name}`}
                      aria-label={`Place ${selectedPhighter.name} ${ability.name}`}
                      style={{ borderColor: selectedPhighter.color }}
                      onDragStart={(event) =>
                        startPlannerImageDrag(event, src, { size: 88 })
                      }
                      onClick={() => placePlannerImage(src)}
                    >
                      <img src={src} alt="" draggable={false} />
                      <span className="ability-key">
                        {ability.key ?? abilityKeys[index]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}

export default App;
