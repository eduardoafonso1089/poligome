export type SamModelFamily = "sam2" | "sam3" | "medsam2";

export type SamPlatformSupportLevel =
  | "supported"
  | "recommended"
  | "wsl-recommended"
  | "partial"
  | "backend-required"
  | "not-documented"
  | "not-supported";

export type SamPlatformSupport = {
  level: SamPlatformSupportLevel;
  notes: string;
};

export type SamRequirements = {
  python: {
    minimum: string;
    notes?: string;
  };
  pytorch: {
    minimum: string;
    torchvisionMinimum: string | null;
    notes?: string;
  };
  cuda: {
    required: boolean;
    minimum: string | null;
    tested?: string;
    notes: string;
  };
  compute: {
    cpuSupported: boolean;
    gpu: "optional" | "recommended" | "required";
    notes: string;
  };
  ram: {
    officialMinimumGb: number | null;
    notes: string;
  };
  vram: {
    officialMinimumGb: number | null;
    notes: string;
  };
  operatingSystem: {
    official: string;
    notes: string;
  };
  access: {
    type: "public" | "gated";
    requiresAccount: boolean;
    requiresTermsAcceptance: boolean;
    notes: string;
  };
};

export type SamCapabilities = {
  imageSegmentation: boolean;
  videoSegmentation: boolean;
  pointPrompts: boolean;
  negativePointPrompts: boolean;
  boxPrompts: boolean;
  maskPrompts: boolean;
  textPrompts: boolean;
  exemplarPrompts: boolean;
  automaticMaskGeneration: boolean;
  multimaskCandidates: boolean;
  interactiveRefinement: boolean;
  instanceSegmentation: boolean;
  conceptSegmentation: boolean;
  videoTracking: boolean;
  multiObjectTracking: boolean;
  bidirectionalPropagation: boolean;
};

export type SamOfficialBenchmark = {
  kind: "sam2-video" | "sam3-image-concepts" | "domain-not-comparable";
  hardware: string;
  software: string | null;
  fps: number | null;
  latencyMs: number | null;
  saVJAndF: number | null;
  moseJAndF: number | null;
  lvosV2JAndF: number | null;
  notes: readonly string[];
  sourceUrl: string;
};

// Todo modelo do catálogo vem de um artigo publicado, então a referência é
// obrigatória e fica visível na tela, não escondida atrás de um link solto.
export type SamCitation = {
  authors: string;
  title: string;
  venue: string;
  year: number;
  url: string;
};

export type SamFutureCapability = {
  name: string;
  version: string;
  scope: "video";
  installable: false;
  status: "released-not-integrated";
  description: string;
  capabilities: readonly string[];
  requirementsSummary: string;
  benchmark: {
    hardware: string;
    objectsPerForwardPass: number;
    mediumObjectVideoFpsBefore: number;
    mediumObjectVideoFpsAfter: number;
    speedupAt128Objects: string;
    notes: readonly string[];
  };
  sourceUrl: string;
};

export type SamModelDefinition = {
  id: string;
  family: SamModelFamily;
  version: "1" | "2.1" | "3" | "2.1-med";
  name: string;
  recommended: boolean;
  experimental: boolean;
  installable: true;
  parameters: {
    count: number;
    label: string;
  };
  checkpoint: {
    fileName: string;
    approximateSizeBytes: number;
    approximateSizeLabel: string;
    format: "PyTorch .pth" | "PyTorch .pt";
    downloadUrl: string;
    gated: boolean;
    notes: string;
  };
  license: {
    name: string;
    spdx: "Apache-2.0" | null;
    url: string;
    notes: string;
  };
  description: string;
  capabilities: SamCapabilities;
  capabilityNotes: readonly string[];
  requirements: SamRequirements;
  benchmark: SamOfficialBenchmark;
  citation: SamCitation;
  platformSupport: {
    linux: SamPlatformSupport;
    windows: SamPlatformSupport;
    macos: SamPlatformSupport;
    browser: SamPlatformSupport;
  };
  futureCapabilities: readonly SamFutureCapability[];
  officialSources: {
    repository: string;
    documentation: string;
    paper: string;
    checkpoint: string;
  };
};

const APACHE_2_LICENSE = {
  name: "Apache License 2.0",
  spdx: "Apache-2.0",
  url: "https://www.apache.org/licenses/LICENSE-2.0",
  notes: "Código e checkpoints oficiais são publicados sob Apache 2.0.",
} as const;

const SAM_LICENSE = {
  name: "SAM License",
  spdx: null,
  url: "https://github.com/facebookresearch/sam3/blob/main/LICENSE",
  notes:
    "Licença própria da Meta, diferente de Apache 2.0. A distribuição deve preservar os termos e há restrições adicionais de uso; valide juridicamente antes de disponibilizar em produção.",
} as const;

const MEDSAM2_WEIGHTS_LICENSE = {
  name: "CC BY-SA 4.0 · somente pesquisa e educação",
  spdx: null,
  url: "https://huggingface.co/wanglab/MedSAM2",
  notes:
    "O código do MedSAM2 é Apache 2.0, mas o card oficial dos pesos declara que eles podem ser usados apenas para pesquisa e educação. Uso comercial não está autorizado; valide juridicamente antes de habilitar este modelo em produção.",
} as const;

function medsam2Benchmark(...extraNotes: readonly string[]): SamOfficialBenchmark {
  return {
    kind: "domain-not-comparable",
    hardware: "não publicado em tabela equivalente",
    software: null,
    fps: null,
    latencyMs: null,
    saVJAndF: null,
    moseJAndF: null,
    lvosV2JAndF: null,
    notes: [
      "Os autores publicam DSC por modalidade, não FPS de vídeo; não há tabela comparável à do SAM 2.1.",
      "Em imagem natural o desempenho cai, porque os pesos foram especializados em imagem médica.",
      ...extraNotes,
    ],
    sourceUrl: "https://github.com/bowang-lab/MedSAM2",
  };
}

const MEDSAM2_CITATION = {
  authors: "Ma, J., Yang, Z., Kim, S., Chen, B., Baharoon, M., Fallahpour, A., Asakereh, R., Lyu, H., Wang, B.",
  title: "MedSAM2: Segment Anything in 3D Medical Images and Videos",
  venue: "arXiv:2504.03600",
  year: 2025,
  url: "https://arxiv.org/abs/2504.03600",
} as const satisfies SamCitation;

const MEDSAM2_SOURCES = {
  repository: "https://github.com/bowang-lab/MedSAM2",
  documentation: "https://github.com/bowang-lab/MedSAM2#readme",
  paper: "https://arxiv.org/abs/2504.03600",
  checkpoint: "https://huggingface.co/wanglab/MedSAM2",
} as const satisfies SamModelDefinition["officialSources"];

// Todos os pesos do MedSAM2 partem do mesmo SAM 2.1 Hiera Tiny, então mudam de
// nome e de tamanho exato mas não de arquitetura: os quatro ajustes finos
// carregam com o sam2.1_hiera_t.yaml oficial e reaproveitam a venv já criada.
function medsam2Checkpoint(fileName: string, approximateSizeBytes: number, notes: string) {
  return {
    fileName,
    approximateSizeBytes,
    approximateSizeLabel: "~156 MB",
    format: "PyTorch .pt",
    downloadUrl: `https://huggingface.co/wanglab/MedSAM2/resolve/main/${fileName}`,
    gated: false,
    notes,
  } as const satisfies SamModelDefinition["checkpoint"];
}

const MEDSAM2_SPECIALIZED_CHECKPOINT_NOTE =
  "Download público no Hugging Face, sem aprovação prévia. Verificamos que o checkpoint carrega com a configuração oficial sam2.1_hiera_t.yaml, a mesma do MedSAM2 generalista.";

const MEDSAM2_PLATFORM_SUPPORT = {
  linux: { level: "recommended", notes: "Usa o mesmo runtime do SAM 2.1; nenhum ambiente adicional é criado." },
  windows: { level: "wsl-recommended", notes: "Mesmo caminho WSL2 do SAM 2.1." },
  macos: { level: "partial", notes: "Herda a limitação do SAM 2.1 no macOS: apenas Apple Silicon e CPU/MPS." },
  browser: { level: "backend-required", notes: "Inferência local pelo conector; não roda no navegador." },
} as const satisfies SamModelDefinition["platformSupport"];

const SAM2_CAPABILITIES = {
  imageSegmentation: true,
  videoSegmentation: true,
  pointPrompts: true,
  negativePointPrompts: true,
  boxPrompts: true,
  maskPrompts: true,
  textPrompts: false,
  exemplarPrompts: false,
  automaticMaskGeneration: true,
  multimaskCandidates: true,
  interactiveRefinement: true,
  instanceSegmentation: true,
  conceptSegmentation: false,
  videoTracking: true,
  multiObjectTracking: true,
  bidirectionalPropagation: true,
} as const satisfies SamCapabilities;

const SAM3_IMAGE_CAPABILITIES = {
  imageSegmentation: true,
  videoSegmentation: true,
  pointPrompts: true,
  negativePointPrompts: true,
  boxPrompts: true,
  // O processor público de imagem do SAM 3 não expõe máscara anterior como prompt.
  maskPrompts: false,
  textPrompts: true,
  exemplarPrompts: true,
  automaticMaskGeneration: false,
  multimaskCandidates: true,
  interactiveRefinement: true,
  instanceSegmentation: true,
  conceptSegmentation: true,
  videoTracking: true,
  multiObjectTracking: true,
  bidirectionalPropagation: true,
} as const satisfies SamCapabilities;

const SAM2_REQUIREMENTS = {
  python: {
    minimum: "3.10",
  },
  pytorch: {
    minimum: "2.5.1",
    torchvisionMinimum: "0.20.1",
    notes: "PyTorch 2.5.1 é também o mínimo para o caminho oficial de compilação completa do modelo de vídeo.",
  },
  cuda: {
    required: false,
    minimum: null,
    tested: "CUDA 12.4 nos benchmarks oficiais",
    notes:
      "A extensão CUDA de pós-processamento é opcional. Para compilá-la, o nvcc deve ser compatível com a versão CUDA do PyTorch.",
  },
  compute: {
    cpuSupported: true,
    gpu: "recommended",
    notes: "CPU é aceita pelo código oficial, mas GPU CUDA é recomendada para interação e propagação de vídeo.",
  },
  ram: {
    officialMinimumGb: null,
    notes: "A Meta não publica um mínimo de RAM; vídeo também precisa armazenar frames e o estado temporal da sessão.",
  },
  vram: {
    officialMinimumGb: null,
    notes: "A Meta não publica um mínimo de VRAM; consumo depende do checkpoint, duração do vídeo, objetos e offload.",
  },
  operatingSystem: {
    official: "Linux; WSL com Ubuntu recomendado no Windows",
    notes: "O README oficial recomenda fortemente WSL com Ubuntu para instalações no Windows.",
  },
  access: {
    type: "public",
    requiresAccount: false,
    requiresTermsAcceptance: false,
    notes: "Download direto dos checkpoints oficiais, sem autenticação.",
  },
} as const satisfies SamRequirements;

const SAM3_REQUIREMENTS = {
  python: {
    minimum: "3.12",
  },
  pytorch: {
    minimum: "2.7",
    torchvisionMinimum: null,
    notes: "O guia oficial atual demonstra a instalação com PyTorch 2.10 e wheels CUDA 12.8.",
  },
  cuda: {
    required: true,
    minimum: "12.6",
    notes:
      "A instalação oficial exige CUDA 12.6 ou superior e uma GPU com capability 7.0 ou maior: as rodas do PyTorch CUDA 12.8 trazem kernels de sm_70 em diante, e numa placa anterior o modelo é reconhecido mas não executa. O instalador confere isso pelo nvidia-smi antes de baixar qualquer coisa.",
  },
  compute: {
    cpuSupported: false,
    gpu: "required",
    notes:
      "Só GPU. Não é uma escolha do Poligome: o código da Meta aloca a codificação de posição com device=\"cuda\" fixo, ignorando o dispositivo pedido, então pedir CPU falha com \"No CUDA GPUs are available\".",
  },
  ram: {
    officialMinimumGb: null,
    notes: "A Meta não publica um mínimo de RAM; somente o checkpoint ocupa aproximadamente 3,45 GB em disco.",
  },
  vram: {
    officialMinimumGb: null,
    notes: "A Meta não publica um mínimo de VRAM; 848M parâmetros, ativações e pós-processamento precisam caber na GPU.",
  },
  operatingSystem: {
    official: "Linux/Conda no procedimento documentado",
    notes: "Windows não possui fluxo oficial próprio e macOS não atende ao requisito CUDA do pacote oficial.",
  },
  access: {
    type: "gated",
    requiresAccount: true,
    requiresTermsAcceptance: true,
    notes:
      "Aprovação manual da Meta. Preencha o formulário em huggingface.co/facebook/sam3 — nome, data de nascimento, país, afiliação e cargo — e espere alguém revisar; não é liberação automática. O status fica em huggingface.co/settings/gated-repos. Aprovado, o instalador chama o `hf auth login` oficial, que guarda o token; o Poligome não o lê nem o armazena.",
  },
} as const satisfies SamRequirements;

const SAM2_PLATFORM_SUPPORT = {
  linux: {
    level: "recommended",
    notes: "Plataforma preferida para o backend Python e CUDA.",
  },
  windows: {
    level: "wsl-recommended",
    notes: "A Meta recomenda fortemente WSL com Ubuntu.",
  },
  macos: {
    level: "partial",
    notes:
      "Roda em CPU e Metal, mas só em Apple Silicon com macOS 14+: o PyTorch 2.5.1+ não publica mais wheels para Mac Intel, e o instalador recusa antes de começar. O caminho CUDA e os benchmarks oficiais não se aplicam.",
  },
  browser: {
    level: "backend-required",
    notes: "A demo web oficial usa frontend e backend; não há execução integral oficial no navegador.",
  },
} as const satisfies SamModelDefinition["platformSupport"];

const SAM3_PLATFORM_SUPPORT = {
  linux: {
    level: "recommended",
    notes: "É o ambiente documentado para Conda, PyTorch e CUDA.",
  },
  windows: {
    level: "not-documented",
    notes: "Não há procedimento oficial próprio; uma instalação via WSL2 ainda depende de GPU e CUDA compatíveis.",
  },
  macos: {
    level: "not-supported",
    notes: "O pacote oficial exige CUDA 12.6+, indisponível no macOS.",
  },
  browser: {
    level: "backend-required",
    notes: "O modelo oficial completo é executado no backend CUDA; não há build oficial para navegador.",
  },
} as const satisfies SamModelDefinition["platformSupport"];

function sam2Benchmark(
  fps: number,
  saVJAndF: number,
  moseJAndF: number,
  lvosV2JAndF: number,
): SamOfficialBenchmark {
  return {
    kind: "sam2-video",
    hardware: "1× NVIDIA A100",
    software: "PyTorch 2.5.1, CUDA 12.4, modelo completamente compilado",
    fps,
    latencyMs: null,
    saVJAndF,
    moseJAndF,
    lvosV2JAndF,
    notes: [
      "FPS e J&F são valores da tabela oficial do SAM 2.1.",
      "Os FPS não representam desempenho em CPU, GPU doméstica ou navegador.",
      "A compilação somente do encoder é mais flexível, porém oferece um ganho menor.",
    ],
    sourceUrl: "https://github.com/facebookresearch/sam2#model-description",
  };
}

const SAM3_IMAGE_BENCHMARK = {
  kind: "sam3-image-concepts",
  hardware: "1× NVIDIA H200",
  software: "Configuração de inferência da Meta; versão detalhada do software não publicada junto ao número",
  fps: null,
  latencyMs: 30,
  saVJAndF: null,
  moseJAndF: null,
  lvosV2JAndF: null,
  notes: [
    "A Meta reporta 30 ms para uma imagem com mais de 100 objetos detectados.",
    "Este número mede inferência de imagem/conceitos e não é diretamente comparável ao FPS de vídeo do SAM 2.1.",
    "Prompts textuais funcionam melhor como frases nominais curtas; consultas relacionais longas não são suportadas diretamente.",
  ],
  sourceUrl: "https://ai.meta.com/blog/segment-anything-model-3/",
} as const satisfies SamOfficialBenchmark;

export const SAM_3_1_VIDEO_CAPABILITY_NOTE = {
  name: "SAM 3.1 Object Multiplex",
  version: "3.1",
  scope: "video",
  installable: false,
  status: "released-not-integrated",
  description:
    "Release publicado pela Meta em 27/03/2026 para tracking denso em vídeo. Agrupa objetos em memória compartilhada para reduzir trabalho redundante; ainda não é uma opção instalável no Poligome.",
  capabilities: [
    "Detecção e tracking em vídeo por texto e prompts visuais",
    "Até 16 objetos processados em um único forward pass",
    "Tracking multiobjeto com memória compartilhada",
    "Compatibilidade conceitual como substituto direto do SAM 3",
  ],
  requirementsSummary:
    "Usa o repositório SAM 3, checkpoint gated próprio e a stack oficial Python 3.12+, PyTorch 2.7+ e CUDA 12.6+.",
  benchmark: {
    hardware: "1× NVIDIA H100",
    objectsPerForwardPass: 16,
    mediumObjectVideoFpsBefore: 16,
    mediumObjectVideoFpsAfter: 32,
    speedupAt128Objects: "~7× frente ao SAM 3 de novembro de 2025",
    notes: [
      "O ganho depende da quantidade de objetos; não implica 2× em todo vídeo.",
      "A Meta reporta resultados mistos em alguns benchmarks de conceito em vídeo e melhora em 6 de 7 benchmarks VOS.",
      "O checkpoint SAM 3.1 ainda não possui integração Hugging Face Transformers.",
    ],
  },
  sourceUrl: "https://github.com/facebookresearch/sam3/blob/main/RELEASE_SAM3p1.md",
} as const satisfies SamFutureCapability;

const SAM2_CITATION = {
  authors: "Ravi, N., Gabeur, V., Hu, Y.-T., Hu, R., Ryali, C., et al.",
  title: "SAM 2: Segment Anything in Images and Videos",
  venue: "arXiv:2408.00714",
  year: 2024,
  url: "https://arxiv.org/abs/2408.00714",
} as const satisfies SamCitation;

const SAM3_CITATION = {
  authors: "Carion, N., Gustafson, L., Hu, Y.-T., Debnath, S., Hu, R., et al.",
  title: "SAM 3: Segment Anything with Concepts",
  venue: "Meta AI Research",
  year: 2025,
  url: "https://ai.meta.com/research/publications/sam-3-segment-anything-with-concepts/",
} as const satisfies SamCitation;

const SAM2_SOURCES = {
  repository: "https://github.com/facebookresearch/sam2",
  documentation: "https://github.com/facebookresearch/sam2#readme",
  paper: "https://ai.meta.com/research/publications/sam-2-segment-anything-in-images-and-videos/",
  checkpoint: "https://github.com/facebookresearch/sam2#download-checkpoints",
} as const;

const SAM3_SOURCES = {
  repository: "https://github.com/facebookresearch/sam3",
  documentation: "https://github.com/facebookresearch/sam3#readme",
  paper: "https://ai.meta.com/research/publications/sam-3-segment-anything-with-concepts/",
  checkpoint: "https://huggingface.co/facebook/sam3",
} as const;

export const SAM_MODELS = [
  {
    id: "sam2.1-hiera-tiny",
    family: "sam2",
    version: "2.1",
    name: "SAM 2.1 Hiera Tiny",
    recommended: false,
    experimental: false,
    installable: true,
    parameters: { count: 38_900_000, label: "38.9M" },
    checkpoint: {
      fileName: "sam2.1_hiera_tiny.pt",
      approximateSizeBytes: 156_008_466,
      approximateSizeLabel: "~156 MB",
      format: "PyTorch .pt",
      downloadUrl: "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt",
      gated: false,
      notes: "Menor e mais rápido checkpoint oficial do SAM 2.1.",
    },
    license: APACHE_2_LICENSE,
    description:
      "Opção leve para imagem e vídeo, indicada quando download, memória e latência têm prioridade sobre a melhor qualidade possível.",
    capabilities: SAM2_CAPABILITIES,
    capabilityNotes: [
      "Propaga máscaras no vídeo, aceita correções em frames e rastreia múltiplos objetos.",
      "Não possui prompt textual nativo; texto exige um detector externo ou SAM 3.",
    ],
    requirements: SAM2_REQUIREMENTS,
    benchmark: sam2Benchmark(91.2, 76.5, 71.8, 77.3),
    citation: SAM2_CITATION,
    platformSupport: SAM2_PLATFORM_SUPPORT,
    futureCapabilities: [],
    officialSources: SAM2_SOURCES,
  },
  {
    id: "sam2.1-hiera-small",
    family: "sam2",
    version: "2.1",
    name: "SAM 2.1 Hiera Small",
    recommended: true,
    experimental: false,
    installable: true,
    parameters: { count: 46_000_000, label: "46M" },
    checkpoint: {
      fileName: "sam2.1_hiera_small.pt",
      approximateSizeBytes: 184_416_285,
      approximateSizeLabel: "~184 MB",
      format: "PyTorch .pt",
      downloadUrl: "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt",
      gated: false,
      notes: "Equilíbrio recomendado entre tamanho, latência e qualidade para o anotador.",
    },
    license: APACHE_2_LICENSE,
    description:
      "Modelo padrão recomendado para segmentação interativa e tracking. É pouco maior que Tiny e melhora especialmente o benchmark MOSE.",
    capabilities: SAM2_CAPABILITIES,
    capabilityNotes: [
      "Propaga máscaras para frente ou para trás e permite adicionar novos objetos depois do início do tracking.",
      "SAM 2.1 melhora objetos pequenos, visualmente semelhantes e situações de oclusão em relação ao SAM 2 original.",
    ],
    requirements: SAM2_REQUIREMENTS,
    benchmark: sam2Benchmark(84.8, 76.6, 73.5, 78.3),
    citation: SAM2_CITATION,
    platformSupport: SAM2_PLATFORM_SUPPORT,
    futureCapabilities: [],
    officialSources: SAM2_SOURCES,
  },
  {
    id: "sam2.1-hiera-base-plus",
    family: "sam2",
    version: "2.1",
    name: "SAM 2.1 Hiera Base+",
    recommended: false,
    experimental: false,
    installable: true,
    parameters: { count: 80_800_000, label: "80.8M" },
    checkpoint: {
      fileName: "sam2.1_hiera_base_plus.pt",
      approximateSizeBytes: 323_606_802,
      approximateSizeLabel: "~324 MB",
      format: "PyTorch .pt",
      downloadUrl: "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt",
      gated: false,
      notes: "Modo de maior qualidade sem chegar ao custo do Hiera Large.",
    },
    license: APACHE_2_LICENSE,
    description:
      "Alternativa de qualidade para imagem e vídeo, com mais parâmetros que Small e latência ainda substancialmente menor que Large no benchmark oficial.",
    capabilities: SAM2_CAPABILITIES,
    capabilityNotes: [
      "Oferece a mesma API e o mesmo conjunto de prompts das demais variantes SAM 2.1.",
      "Não possui prompt textual nativo.",
    ],
    requirements: SAM2_REQUIREMENTS,
    benchmark: sam2Benchmark(64.1, 78.2, 73.7, 78.2),
    citation: SAM2_CITATION,
    platformSupport: SAM2_PLATFORM_SUPPORT,
    futureCapabilities: [],
    officialSources: SAM2_SOURCES,
  },
  {
    id: "sam2.1-hiera-large",
    family: "sam2",
    version: "2.1",
    name: "SAM 2.1 Hiera Large",
    recommended: false,
    experimental: false,
    installable: true,
    parameters: { count: 224_400_000, label: "224.4M" },
    checkpoint: {
      fileName: "sam2.1_hiera_large.pt",
      approximateSizeBytes: 898_083_611,
      approximateSizeLabel: "~898 MB",
      format: "PyTorch .pt",
      downloadUrl: "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_large.pt",
      gated: false,
      notes: "Maior checkpoint SAM 2.1, voltado ao melhor resultado oficial da família na maioria dos benchmarks publicados.",
    },
    license: APACHE_2_LICENSE,
    description:
      "Variante de máxima qualidade do SAM 2.1. Requer mais download, memória e tempo de inferência que Tiny, Small e Base+.",
    capabilities: SAM2_CAPABILITIES,
    capabilityNotes: [
      "Oferece a mesma API e o mesmo conjunto de prompts das demais variantes SAM 2.1.",
      "Use como modo de qualidade; não como escolha automática em máquinas desconhecidas.",
    ],
    requirements: SAM2_REQUIREMENTS,
    benchmark: sam2Benchmark(39.5, 79.5, 74.6, 80.6),
    citation: SAM2_CITATION,
    platformSupport: SAM2_PLATFORM_SUPPORT,
    futureCapabilities: [],
    officialSources: SAM2_SOURCES,
  },
  {
    id: "medsam2-latest",
    family: "medsam2",
    version: "2.1-med",
    name: "MedSAM2 (imagem médica)",
    recommended: false,
    experimental: true,
    installable: true,
    parameters: { count: 38_900_000, label: "38.9M" },
    checkpoint: medsam2Checkpoint(
      "MedSAM2_latest.pt",
      156_040_129,
      "Download público no Hugging Face, sem aprovação prévia, diferente do SAM 3. Verificamos que o checkpoint carrega com a configuração oficial sam2.1_hiera_t.yaml.",
    ),
    license: MEDSAM2_WEIGHTS_LICENSE,
    description:
      "Ajuste fino do SAM 2.1 Hiera Tiny para imagem médica, treinado pelo grupo de Bo Wang sobre TC, RM e ultrassom. Reaproveita o runtime do SAM 2.1 já instalado, sem criar ambiente novo.",
    capabilities: SAM2_CAPABILITIES,
    capabilityNotes: [
      "Aceita os mesmos prompts do SAM 2.1: pontos positivos e negativos, além de caixas.",
      "Especializado em TC, RM e ultrassom; em fotografia comum o resultado é pior que o do SAM 2.1 padrão.",
      "Não cobre radiografia odontológica, que não faz parte do treino publicado.",
      "É o generalista médico do grupo: prefira-o quando a modalidade não coincidir com um dos ajustes finos por modalidade.",
    ],
    requirements: SAM2_REQUIREMENTS,
    benchmark: medsam2Benchmark(),
    citation: MEDSAM2_CITATION,
    platformSupport: MEDSAM2_PLATFORM_SUPPORT,
    futureCapabilities: [],
    officialSources: MEDSAM2_SOURCES,
  },
  {
    id: "medsam2-ct-lesion",
    family: "medsam2",
    version: "2.1-med",
    name: "MedSAM2 · lesão em TC",
    recommended: false,
    experimental: true,
    installable: true,
    parameters: { count: 38_900_000, label: "38.9M" },
    checkpoint: medsam2Checkpoint("MedSAM2_CTLesion.pt", 156_041_079, MEDSAM2_SPECIALIZED_CHECKPOINT_NOTE),
    license: MEDSAM2_WEIGHTS_LICENSE,
    description:
      "Ajuste fino do MedSAM2 para segmentação de lesões em tomografia computadorizada. Mesmo runtime e mesmo tamanho do MedSAM2 generalista, com os pesos especializados em TC.",
    capabilities: SAM2_CAPABILITIES,
    capabilityNotes: [
      "Aceita os mesmos prompts do SAM 2.1: pontos positivos e negativos, além de caixas.",
      "Treinado para lesão em TC; fora dessa modalidade o generalista MedSAM2 tende a ser a escolha melhor.",
      "Os autores não publicam avaliação em radiografia odontológica, então o uso em CBCT dental é uma extrapolação a validar caso a caso.",
    ],
    requirements: SAM2_REQUIREMENTS,
    benchmark: medsam2Benchmark("Os autores descrevem este peso como ajuste fino para lesão em TC, sem tabela própria de latência."),
    citation: MEDSAM2_CITATION,
    platformSupport: MEDSAM2_PLATFORM_SUPPORT,
    futureCapabilities: [],
    officialSources: MEDSAM2_SOURCES,
  },
  {
    id: "medsam2-mri-liver-lesion",
    family: "medsam2",
    version: "2.1-med",
    name: "MedSAM2 · lesão hepática em RM",
    recommended: false,
    experimental: true,
    installable: true,
    parameters: { count: 38_900_000, label: "38.9M" },
    checkpoint: medsam2Checkpoint("MedSAM2_MRI_LiverLesion.pt", 156_044_532, MEDSAM2_SPECIALIZED_CHECKPOINT_NOTE),
    license: MEDSAM2_WEIGHTS_LICENSE,
    description:
      "Ajuste fino do MedSAM2 para lesão hepática em ressonância magnética. É o mais estreito dos pesos publicados: um órgão e uma modalidade.",
    capabilities: SAM2_CAPABILITIES,
    capabilityNotes: [
      "Aceita os mesmos prompts do SAM 2.1: pontos positivos e negativos, além de caixas.",
      "Escopo publicado é lesão hepática em RM; para outros órgãos na mesma modalidade, comece pelo generalista MedSAM2.",
    ],
    requirements: SAM2_REQUIREMENTS,
    benchmark: medsam2Benchmark("Os autores descrevem este peso como ajuste fino para lesão hepática em RM, sem tabela própria de latência."),
    citation: MEDSAM2_CITATION,
    platformSupport: MEDSAM2_PLATFORM_SUPPORT,
    futureCapabilities: [],
    officialSources: MEDSAM2_SOURCES,
  },
  {
    id: "medsam2-us-heart",
    family: "medsam2",
    version: "2.1-med",
    name: "MedSAM2 · ecocardiograma",
    recommended: false,
    experimental: true,
    installable: true,
    parameters: { count: 38_900_000, label: "38.9M" },
    checkpoint: medsam2Checkpoint("MedSAM2_US_Heart.pt", 156_041_079, MEDSAM2_SPECIALIZED_CHECKPOINT_NOTE),
    license: MEDSAM2_WEIGHTS_LICENSE,
    description:
      "Ajuste fino do MedSAM2 para ultrassom cardíaco. O treino do upstream é em vídeo de ecocardiograma; este editor usa os pesos quadro a quadro, porque ainda integra apenas imagem.",
    capabilities: SAM2_CAPABILITIES,
    capabilityNotes: [
      "Aceita os mesmos prompts do SAM 2.1: pontos positivos e negativos, além de caixas.",
      "O ajuste fino oficial é para vídeo de ultrassom cardíaco; sem a timeline integrada, cada quadro é anotado isoladamente e o ganho temporal do modelo fica sem uso.",
    ],
    requirements: SAM2_REQUIREMENTS,
    benchmark: medsam2Benchmark("Os autores descrevem este peso como ajuste fino para vídeo de ultrassom cardíaco, sem tabela própria de latência."),
    citation: MEDSAM2_CITATION,
    platformSupport: MEDSAM2_PLATFORM_SUPPORT,
    futureCapabilities: [],
    officialSources: MEDSAM2_SOURCES,
  },
  {
    id: "medsam2-2411",
    family: "medsam2",
    version: "2.1-med",
    name: "MedSAM2 2411 (versão anterior)",
    recommended: false,
    experimental: true,
    installable: true,
    parameters: { count: 38_900_000, label: "38.9M" },
    checkpoint: medsam2Checkpoint(
      "MedSAM2_2411.pt",
      156_039_179,
      "Download público no Hugging Face. Peso base de novembro de 2024, mantido no repositório oficial para reprodutibilidade; carrega com o mesmo sam2.1_hiera_t.yaml.",
    ),
    license: MEDSAM2_WEIGHTS_LICENSE,
    description:
      "Peso base do MedSAM2 de novembro de 2024, anterior ao generalista atual. Existe para reproduzir resultados publicados sobre ele; para uso novo, prefira o MedSAM2 (imagem médica).",
    capabilities: SAM2_CAPABILITIES,
    capabilityNotes: [
      "Aceita os mesmos prompts do SAM 2.1: pontos positivos e negativos, além de caixas.",
      "Os próprios autores marcam o generalista atual como recomendado e mantêm este apenas como versão anterior.",
    ],
    requirements: SAM2_REQUIREMENTS,
    benchmark: medsam2Benchmark("Peso anterior ao generalista atual; os autores não publicam comparação direta entre os dois."),
    citation: MEDSAM2_CITATION,
    platformSupport: MEDSAM2_PLATFORM_SUPPORT,
    futureCapabilities: [],
    officialSources: MEDSAM2_SOURCES,
  },
  {
    id: "sam3-concepts",
    family: "sam3",
    version: "3",
    name: "SAM 3 — Imagem e conceitos",
    recommended: false,
    experimental: true,
    installable: true,
    parameters: { count: 848_000_000, label: "848M" },
    checkpoint: {
      fileName: "sam3.pt",
      // Tamanho exato do arquivo, conferido no download com a conta aprovada.
      approximateSizeBytes: 3_450_062_241,
      approximateSizeLabel: "~3.45 GB",
      format: "PyTorch .pt",
      downloadUrl: "https://huggingface.co/facebook/sam3",
      gated: true,
      notes:
        "Checkpoint oficial único, com 3.450.062.241 bytes. Sem a aprovação da Meta o download responde HTTP 401 e a instalação para; não há espelho alternativo.",
    },
    license: SAM_LICENSE,
    description:
      "Modelo experimental para imagens que detecta e segmenta todas as instâncias de um conceito descrito por texto curto ou por exemplos visuais.",
    capabilities: SAM3_IMAGE_CAPABILITIES,
    capabilityNotes: [
      "O escopo instalável desta fase é somente imagem/conceitos, embora o upstream SAM 3 também possua APIs de vídeo.",
      "Texto funciona melhor como frase nominal curta, por exemplo `carro vermelho`; descrições relacionais longas exigem outro modelo de raciocínio.",
      "Exemplares positivos e negativos podem complementar ou substituir o texto para localizar conceitos visualmente semelhantes.",
    ],
    requirements: SAM3_REQUIREMENTS,
    benchmark: SAM3_IMAGE_BENCHMARK,
    citation: SAM3_CITATION,
    platformSupport: SAM3_PLATFORM_SUPPORT,
    futureCapabilities: [SAM_3_1_VIDEO_CAPABILITY_NOTE],
    officialSources: SAM3_SOURCES,
  },
] as const satisfies readonly SamModelDefinition[];

// ---------------------------------------------------------------------------
// BYOM: modelos em contêiner trazidos pelo usuário
//
// O propósito é diferente do SAM. Não há prompt: o contêiner recebe a imagem
// inteira e devolve um documento COCO já rotulado, que o editor renderiza como
// anotações prontas para revisão. Por isso um BYOM não entra no catálogo
// estático nem na troca de modelos — ele é anunciado pelo conector em
// GET /byom/models, e só existe depois que alguém registra um contêiner.
// ---------------------------------------------------------------------------

export const BYOM_MODEL_ID_PATTERN = /^byom-[a-z0-9][a-z0-9._-]{0,62}$/;

export function isByomModelId(value: unknown): value is string {
  return typeof value === "string" && BYOM_MODEL_ID_PATTERN.test(value);
}

/** O que um contêiner declara sobre si em GET /metadata, que é opcional. */
export type ByomMetadata = {
  task: string | null;
  description: string | null;
  limitations: string | null;
  categories: string[];
  geometry: string[];
  parameters: Record<string, string>;
};

/** O que a última execução devolveu, observado pelo conector. */
export type ByomLastRun = {
  annotations: number;
  categories: string[];
  geometry: string[];
};

/** Um modelo BYOM como o conector local o anuncia. */
export type ByomModel = {
  model_id: string;
  name: string;
  image: string;
  endpoint: string;
  notes: string;
  env: Record<string, string>;
  last_run: ByomLastRun | null;
  metadata: ByomMetadata | null;
  ready: boolean;
  unavailable_reason: string | null;
};

const GEOMETRY_LABELS: Record<string, string> = {
  polygon: "máscaras",
  bbox: "caixas",
  keypoints: "pontos",
};

function describeList(items: readonly string[]): string {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

/** Monta uma explicação legível do que o modelo faz.
 *
 * Prefere o que o contêiner declara em /metadata, porque vale antes da primeira
 * execução; sem isso, cai no que a última execução realmente devolveu. Quando
 * não há nem um nem outro, diz isso em vez de inventar.
 */
export function describeByomModel(model: ByomModel): string {
  const parts: string[] = [];
  if (model.metadata?.task) parts.push(`${model.metadata.task}.`);
  if (model.metadata?.description) parts.push(model.metadata.description);

  const declared = model.metadata?.categories ?? [];
  const observed = model.last_run?.categories ?? [];
  const categories = declared.length ? declared : observed;
  const source = declared.length ? "declara" : "na última execução devolveu";
  if (categories.length) {
    const plural = categories.length === 1 ? "classe" : "classes";
    parts.push(`Segundo o COCO, ${source} ${categories.length} ${plural}: ${describeList(categories)}.`);
  }

  const geometry = (model.metadata?.geometry ?? model.last_run?.geometry ?? [])
    .map((item) => GEOMETRY_LABELS[item] ?? item);
  if (geometry.length) parts.push(`Exporta ${describeList(geometry)}.`);

  if (model.last_run) {
    const count = model.last_run.annotations;
    parts.push(`Na última imagem produziu ${count} ${count === 1 ? "anotação" : "anotações"}.`);
  }

  if (!parts.length) {
    return model.ready
      ? "Este contêiner não implementa GET /metadata e ainda não foi executado, então não há o que descrever. Rode-o uma vez sobre uma imagem."
      : "O contêiner está parado, então não dá para descrevê-lo. Suba-o para ver as classes que ele exporta.";
  }
  return parts.join(" ");
}

export type SamModel = (typeof SAM_MODELS)[number];
export type SamModelId = SamModel["id"];

export const DEFAULT_SAM_MODEL_ID: SamModelId = "sam2.1-hiera-small";

export function isSamModelId(value: unknown): value is SamModelId {
  return typeof value === "string" && SAM_MODELS.some((model) => model.id === value);
}

export function getSamModel(id: string): SamModel | undefined {
  return SAM_MODELS.find((model) => model.id === id);
}

export const getSamModelById = getSamModel;

export function isSamModel(value: unknown): value is SamModel {
  return SAM_MODELS.some((model) => model === value);
}
