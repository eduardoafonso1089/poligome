import type { Language } from "./i18n";
import type { Asset, Label } from "./types";
import type { EditorAnnotation } from "../editor/models/annotation-model";
import { createBox, createPoint, createPolygonFromFlat, createPolylineFromFlat } from "../editor/models/annotation-factory";

type CanonicalDemoProject = {
  name: string;
  assets: Asset[];
  labels: Label[];
  annotations: EditorAnnotation[];
  objectUrls: string[];
};

const demoCopy: Record<Language, {
  project: string;
  scenes: [string, string, string];
  labels: [string, string, string, string, string];
}> = {
  pt: { project: "Demo — Mapeamento por imagens aéreas", scenes: ["quadra-urbana.jpg", "parque-municipal.jpg", "zona-rural.jpg"], labels: ["Edificação", "Vegetação", "Veículo", "Água", "Caminho"] },
  en: { project: "Demo — Aerial image mapping", scenes: ["urban-block.jpg", "city-park.jpg", "rural-area.jpg"], labels: ["Building", "Vegetation", "Vehicle", "Water", "Path"] },
  fr: { project: "Démo — Cartographie par images aériennes", scenes: ["quartier-urbain.jpg", "parc-municipal.jpg", "zone-rurale.jpg"], labels: ["Bâtiment", "Végétation", "Véhicule", "Eau", "Chemin"] },
  es: { project: "Demo — Mapeo con imágenes aéreas", scenes: ["manzana-urbana.jpg", "parque-municipal.jpg", "zona-rural.jpg"], labels: ["Edificación", "Vegetación", "Vehículo", "Agua", "Camino"] },
};

const sources = ["/demo/urban-aerial.jpg", "/demo/park-aerial.jpg", "/demo/rural-aerial.jpg"];
const DEMO_SCALE = 1.2;

function scaleAnnotation(annotation: EditorAnnotation, scale: number): EditorAnnotation {
  if (annotation.type === "polygon") return {
    ...annotation,
    vertices: annotation.vertices.map((vertex) => ({ ...vertex, x: vertex.x * scale, y: vertex.y * scale })),
    holes: annotation.holes.map((hole) => hole.map((vertex) => ({ ...vertex, x: vertex.x * scale, y: vertex.y * scale }))),
  };
  if (annotation.type === "line") {
    return { ...annotation, vertices: annotation.vertices.map((vertex) => ({ ...vertex, x: vertex.x * scale, y: vertex.y * scale })) };
  }
  if (annotation.type === "box") {
    return { ...annotation, x: annotation.x * scale, y: annotation.y * scale, width: annotation.width * scale, height: annotation.height * scale };
  }
  return { ...annotation, x: annotation.x * scale, y: annotation.y * scale };
}

export async function createCanonicalDemoProject(language: Language): Promise<CanonicalDemoProject> {
  const responses = await Promise.all(sources.map((source) => fetch(source)));
  if (responses.some((response) => !response.ok)) throw new Error("Could not load the demo images.");
  const blobs = await Promise.all(responses.map((response) => response.blob()));
  const objectUrls = blobs.map((blob) => URL.createObjectURL(blob));
  const text = demoCopy[language];
  const ids = ["demo-urban", "demo-park", "demo-rural"];
  const assets = blobs.map((blob, index): Asset => ({
    id: ids[index],
    name: text.scenes[index],
    src: objectUrls[index],
    local: true,
    byteSize: blob.size,
    width: 1200,
    height: 780,
  }));
  const labels: Label[] = [
    { id: "demo-building", name: text.labels[0], color: "#8D75FF", key: "1" },
    { id: "demo-vegetation", name: text.labels[1], color: "#4DAA78", key: "2" },
    { id: "demo-vehicle", name: text.labels[2], color: "#E57A44", key: "3" },
    { id: "demo-water", name: text.labels[3], color: "#4B9BC1", key: "4" },
    { id: "demo-path", name: text.labels[4], color: "#C69445", key: "5" },
  ];
  const referenceAnnotations: EditorAnnotation[] = [
    createPolygonFromFlat({ id: "demo-a1", asset: ids[0], label: labels[0].id }, [115,137,326,137,326,337,189.53681518176072,337.70071011805146,188.59603992415,304.7729431453254,111.45246880007056,303.83214980324755]),
    createPolygonFromFlat({ id: "demo-a2", asset: ids[0], label: labels[0].id }, [357,68,567.7284687412722,72.39698765208739,566.7876934836614,282.19390293545615,357,277]),
    createPolygonFromFlat({ id: "demo-a3", asset: ids[0], label: labels[0].id }, [789.7514295374032,99.6799945723461,938.3939202398976,97.79840788819033,962.8540769377765,263.3780360938984,804,266]),
    createBox({ id: "demo-a4", asset: ids[0], label: labels[2].id }, { x:640,y:151,width:28,height:67 }),
    createBox({ id: "demo-a5", asset: ids[0], label: labels[2].id }, { x:48,y:451,width:68,height:42 }),
    createBox({ id: "demo-a6", asset: ids[0], label: labels[2].id }, { x:697,y:451,width:38,height:77 }),
    createPoint({ id: "demo-a7", asset: ids[0], label: labels[1].id }, { x:453,y:327 }),
    createPolygonFromFlat({ id: "demo-b1", asset: ids[1], label: labels[3].id }, [587.4847491510973,78.04174770455471,648.6351408957944,36.64684065312768,728.601037792706,74.27857433624315,761.5281718090814,147.66045501831834,810.4484852048391,269.02279614636575,816.0931367505034,390.3851372744132,821.7377882961679,430.83925098376227,808.5669346896177,469.4117780089556,783.166002734128,488.22764485051334,753.061194490585,533.3857252702519,714.4894089285452,504.22113166583745,662,544,578.0769965749902,503.28033832375957,515.0450543150715,459.06305124609884,468.947066692146,397.9114840110362,476.4732687530318,343.3454701705188,515.0450543150715,295.36500972454655,560,190]),
    createPolygonFromFlat({ id: "demo-b2", asset: ids[1], label: labels[0].id }, [118.03789560334563,465.6486046406441,207.4115450763645,420.4905242209055,225.28627497096826,475.05653806142294,137,519]),
    createPolylineFromFlat({ id: "demo-b3", asset: ids[1], label: labels[4].id }, [78.5253347836952,650,139.6757265283923,615.2347460310281,172.60286054476768,590.774119137003,200.8261182730894,566.313492242978,230.9309265166326,518.3330317970058,252.56875744167928,464.7078112985662,298.66674506460475,381.91799719571213,354.1724852636376,290.66104301415714,405,175,422.84907906922047,108.1471346510471,447.3092357670993,39.46922067936135,497.17032442046775,0.8966936541679859]),
    createBox({ id: "demo-b4", asset: ids[1], label: labels[2].id }, { x:387.2961237119464,y:191.58555339454523,width:20,height:34,rotation:0.4132347145292916 }),
    createPoint({ id: "demo-b5", asset: ids[1], label: labels[1].id }, { x:178,y:205 }),
    createPolygonFromFlat({ id: "demo-c1", asset: ids[2], label: labels[1].id }, [0,0,629,0,651.4574666686266,102.50237459857976,537.6236604977289,133.54855488715003,494.34799864763556,254.9108960151974,0,265]),
    createPolygonFromFlat({ id: "demo-c2", asset: ids[2], label: labels[1].id }, [631,322,1000,326,1000,650,586.5439738934865,650]),
    createPolygonFromFlat({ id: "demo-c3", asset: ids[2], label: labels[3].id }, [486.82179658674977,358.39816364376503,531.9790089520645,346.16785019675245,553.6168398771111,364.0429236962323,561.143041937997,405.4378307476593,565,486,532,503,511.2819532846287,446.8327377990864,488,410]),
    createPolygonFromFlat({ id: "demo-c4", asset: ids[2], label: labels[0].id }, [561.143041937997,166.47632185987607,611,176,594.0701759543724,246.44375593649644,548,230]),
    createBox({ id: "demo-c5", asset: ids[2], label: labels[2].id }, { x:439,y:269,width:24,height:18 }),
    createPolylineFromFlat({ id: "demo-c6", asset: ids[2], label: labels[4].id }, [2.3225389172264768,286.89786964584556,106.74859251201693,290.66104301415714,213.05619662202884,284.0754896196119,326.89000279292657,271.8451761725994,439,272,538.5644357553397,264.3188294359763,630,269,810,268,1000,272]),
  ];
  return {
    name: text.project,
    assets,
    labels,
    annotations: referenceAnnotations.map((annotation) => scaleAnnotation(annotation, DEMO_SCALE)),
    objectUrls,
  };
}
