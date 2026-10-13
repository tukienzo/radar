// Tipos del Radar de contenido. Las filas son las tablas radar_* (supabase/migrations/20260929000001_radar.sql);
// los "Datos*" son lo que consume la página (public/radar/index.html).

export type TipoMedia = "reel" | "carrusel" | "post"

export type Semilla = {
  handle: string
  tags: string[]
  activa: boolean
  historias: boolean
  nota: string | null
  nombre: string | null
  bio: string | null
  foto_path: string | null
  foto_remota: string | null
  seguidores: number | null
  posts: number | null
  perfil_at: string | null
  dossier: Dossier | null
  dossier_at: string | null
  creado_por: string | null
  created_at: string
  updated_at: string
}

export type SlidePieza = { n: number; path: string; texto?: string; visual?: string }

export type Analisis = {
  formato: string
  tipo: string
  nivel_conciencia: string
  hook_texto: string
  hook_patron: string
  estructura: string[]
  cta: string
  keyword: string
  recurso_prometido: string
  por_que_pega: string
  angulo_bm_id: number          // número del banco de ángulos del CRM; 0 = ninguno
  angulo_bm_nombre: string
  recreable: boolean
  como_recrear: string
  temas: string[]
  angulo_comunicacion: string
  tipo_angulo: string
  avatar: string
  promesa: string
  modelo: string
  con_medios: boolean
}

export type Objetivo = { objetivo: "alcance" | "lead_magnet" | "gatillo"; keyword: string; c: number }

export type Guion = {
  topic: string; opening: string; mechanism: string; structure: string; evidence: string
  emotion: string; specificity: string; cta: string; tema_bm: string
  conf: Record<string, number>
  tramos: Array<[string, string]>      // [texto, rol]
  ro: { pos: Record<string, number>; sec: string[] }
}

export type Lectura = { diseno: string; estructura: string; cierre: string }

export type Recreacion = {
  reel: { titulo: string; hook: string; guion: Array<{ beat: string; texto: string; visual: string }>; cta: string; caption: string; duracion_seg: number; formato_sugerido: string }
  carrusel: { titulo: string; estilo_sugerido: string; slides: Array<{ n: number; texto: string; visual: string }>; caption: string }
  historias: Array<{ n: number; en_pantalla: string; hablado: string; sticker: string }>
  hooks: string[]
  nota_estratega: string
  violaciones: string[]
  generado: string
  modelo: string
}

export type Dossier = {
  cuenta: string
  dias: number
  generado: string
  veredicto: string
  secciones: Array<{ titulo: string; items: string[] }>
  robar: Array<{ titulo: string; por_que: string; formato: string; hook: string; keyword: string; recurso: string; referencia_id: string }>
  modelo: string
}

export type Pieza = {
  id: string
  plataforma: string
  cuenta: string
  cuenta_fuente: string
  url: string
  tipo_media: TipoMedia
  fecha: string
  caption: string | null
  likes: number | null
  comentarios: number | null
  views: number | null
  duracion: number | null
  fijado: boolean
  thumb_path: string | null
  thumb_remota: string | null
  slides: SlidePieza[] | null
  slides_remotas: string[] | null
  video_url: string | null
  video_url_at: string | null
  transcript: string | null
  transcript_error: string | null
  analisis: Analisis | null
  analisis_at: string | null
  analisis_error: string | null
  objetivo: Objetivo | null
  guion: Guion | null
  lectura: Lectura | null
  recreacion: Recreacion | null
  recreacion_at: string | null
  visto_at: string
  medido_at: string
}

export type Stickers = { links?: string[]; encuestas?: string[]; preguntas?: string[]; menciones?: string[]; musica?: boolean }

export type MetricasHistoria = {
  alcance: number | null; views: number | null; respuestas: number | null; shares: number | null
  visitas: number | null; follows: number | null; salidas: number | null; avances: number | null; retrocesos: number | null
  salida_pct: number | null; resp_k: number | null
}

export type Historia = {
  id: string
  cuenta: string
  fecha: string
  vence: string | null
  tipo: string | null
  dur: number | null
  caption: string | null
  tx: string | null
  tx_error: string | null
  stickers: Stickers
  frame_path: string | null
  frame_remota: string | null
  video_url: string | null
  video_url_at: string | null
  url: string | null
  metricas: MetricasHistoria | null
  metricas_at: string | null
  lectura: { tipo: string; texto: string; cta: boolean; keyword: string } | null
  fuente: string
}

export type Corrida = {
  id: string
  tipo: "piezas" | "perfiles" | "historias" | "comentarios" | "propias" | "analisis"
  estado: "lanzada" | "recogida" | "error"
  actor: string | null
  apify_run_id: string | null
  apify_dataset_id: string | null
  cuentas: string[]
  items: number | null
  nuevos: number | null
  costo_usd: number | null
  error: string | null
  detalle: Record<string, unknown> | null
  pedida_por: string | null
  iniciado: string
  terminado: string | null
}

export type MineriaComentarios = {
  dolores: Array<{ tema: string; n: number; ejemplos: string[] }>
  objeciones: Array<{ tema: string; n: number; ejemplos: string[] }>
  preguntas: Array<{ pregunta: string; n: number }>
  jerga: Array<{ palabra: string; contexto: string }>
  ideas_contenido: string[]
}

// Lo que ve la grilla: la pieza con sus métricas derivadas, sin los campos pesados (van en el detalle).
export type PiezaVista = {
  id: string; plataforma: string; cuenta: string; cuenta_fuente: string; url: string; tipo_media: TipoMedia
  fecha: string; semana: string; caption: string; likes: number | null; comentarios: number | null; views: number | null
  duracion: number | null; tasa_com: number | null; outlier: number | null; outlier_com: number | null; eng_x_seg: number | null
  dias: number; velocidad: number | null; score: number; fijado: boolean
  analisis: Analisis | null; objetivo: Objetivo | null; recreacion: boolean
  thumb_local: string | null; n_slides: number; con_transcript: boolean
}
