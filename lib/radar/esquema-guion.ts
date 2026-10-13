// Esquema de la anatomía del guion (pestaña Guion del Radar): nueve dimensiones con una etiqueta cada una y
// ocho roles para los tramos. Las etiquetas van en inglés porque son la clave que guarda la base y la que
// espera la página; la traducción que ve el usuario está en public/radar/index.html (GL_ES).
// "tema_bm" es la dimensión propia del negocio: de qué habla la pieza vista desde lo que vende la marca.
// Sus etiquetas son genéricas: ajustalas a tu negocio (y su traducción en GL_ES.tema_bm de la página).

import { BRAND } from "@/lib/brand"

export const DIMENSIONES = {
  topic: {
    pregunta: "tema central del transcript completo",
    etiquetas: {
      business: "construcción de negocio, emprendimiento, operaciones", money: "finanzas personales, ingresos, inversión",
      marketing: "marketing, ventas, audiencia, contenido", mindset: "creencias, motivación, resiliencia, confianza",
      habits: "productividad, disciplina, rutinas", relationships: "relaciones, comunicación, vida social", health: "salud, fitness",
      technology: "tecnología, IA, software, herramientas", other: "tema claro fuera de los anteriores", unclear: "habla insuficiente o ambigua",
    },
  },
  opening: {
    pregunta: "forma superficial de la PRIMERA oración hablada. Pregunta retórica cuenta como question. Forma, no mecanismo",
    etiquetas: {
      question: "abre preguntando", instruction: "abre con una directiva al espectador", claim: "abre con una afirmación u observación",
      story: "abre narrando un evento o experiencia personal", dialogue: "abre con diálogo citado o conversacional", unclear: "habla insuficiente o ambigua",
    },
  },
  mechanism: {
    pregunta: "razón dominante por la que la apertura invita a seguir escuchando. Usá SOLO la apertura. Preferí el mecanismo más explícito",
    etiquetas: {
      contradiction: "desafía una creencia o expectativa familiar", curiosity: "retiene una respuesta específica o crea un gap de información explícito",
      result: "promete o muestra un resultado concreto deseable", mistake: "advierte un error, costo, riesgo o pérdida",
      recognition: "nombra una situación o frustración reconocible del espectador", story: "introduce un evento con desenlace sin resolver",
      direct: "plantea el tema o consejo directo sin otro mecanismo claro", unclear: "habla insuficiente o ambigua",
    },
  },
  structure: {
    pregunta: "estructura organizadora dominante de TODO el transcript (la que carga la enseñanza principal)",
    etiquetas: {
      story: "eventos que desembocan en una lección", steps: "secuencia, checklist o lista de tips", problem_solution: "problema seguido de remedio",
      explanation: "explica cómo o por qué funciona algo", comparison: "compara dos o más enfoques o alternativas", opinion: "argumenta un punto de vista",
      qa: "intercambio pregunta-respuesta", unclear: "habla insuficiente o ambigua",
    },
  },
  evidence: {
    pregunta: "forma principal de respaldo del claim central (no si es verdad)",
    etiquetas: {
      example: "ejemplo concreto o escenario trabajado", personal: "anécdota personal o experiencia de primera mano", numbers: "resultado numérico o claim cuantitativo",
      source: "persona, publicación o estudio externo nombrado", reasoning: "cadena de razonamiento sin evidencia concreta", none: "sin respaldo explícito",
      unclear: "habla insuficiente o ambigua",
    },
  },
  emotion: {
    pregunta: "apelación emocional más explícita en las palabras (no cómo se sintió la audiencia)",
    etiquetas: {
      aspiration: "deseo de logro o mejor futuro", concern: "miedo, riesgo, preocupación, pérdida", relief: "reaseguro, validación, alivio",
      surprise: "revelación inesperada o incongruencia", amusement: "humor, entretenimiento", neutral: "mayormente informativo", unclear: "habla insuficiente o ambigua",
    },
  },
  specificity: {
    pregunta: "qué tan accionable es el consejo principal (no un ejemplo al pasar)",
    etiquetas: {
      none: "no da consejo", principle: "principio general sin acción concreta", action: "una acción específica que el espectador podría hacer",
      sequence: "varias acciones concretas ordenadas", unclear: "habla insuficiente o ambigua",
    },
  },
  cta: {
    pregunta: "call to action explícito en el CIERRE hablado. No uses el caption. Un consejo de vida general no es CTA",
    etiquetas: {
      none: "sin CTA social o comercial explícito", follow: "seguir o suscribirse", engage: "like, guardar, compartir",
      comment: "comentar o responder (incluye 'comentá la palabra X')", visit: "visitar link, web u otro recurso (incluye 'link en bio', 'escribime por DM')",
      buy: "comprar o agendar", multiple: "varios CTA explícitos distintos", unclear: "habla insuficiente o ambigua",
    },
  },
  tema_bm: {
    pregunta: `dimensión propia de ${BRAND.name}: de qué habla la pieza vista desde lo que vende el negocio (ver el contexto del negocio)`,
    etiquetas: {
      herramientas: "herramientas, demos, listas o comparativas de productos o software", oferta: "cómo armar o cobrar una oferta, precios, qué incluye",
      clientes: "cómo conseguir o cerrar clientes: contenido, mensajes directos, prospección, llamadas de venta", caso: "caso de un alumno o cliente",
      operacion: "detrás de escena del propio negocio, sistemas, procesos, equipo", educacion: "enseña algo del tema del negocio: tutorial, explicación, paso a paso",
      estilo_vida: "estilo de vida, rutina o vida personal de quien comunica", mindset: "motivación, procrastinación, creencias, historia personal",
      otro: "otro", unclear: "habla insuficiente o ambigua",
    },
  },
} as const

export const ROLES = {
  hook: "crea la razón inicial para seguir escuchando",
  setup: "da el contexto necesario para entender el punto",
  problem: "nombra un obstáculo, error, costo o conflicto",
  example: "ilustración, anécdota, evidencia o caso concreto",
  advice: "la recomendación principal o la explicación de qué hacer",
  payoff: "resuelve la pregunta de apertura o entrega la conclusión clave",
  cta: "pedido explícito de seguir, comentar, compartir, visitar o comprar",
  other: "transición o material sin otro rol claro",
} as const

export const OBJETIVOS = {
  alcance: "atracción masiva: busca vistas, compartidos o seguidores. No pide un lead ni empuja a comprar (curiosidad, noticia, opinión, humor, tendencia)",
  lead_magnet: "capta el lead: pide comentar o escribir una palabra clave a cambio de un recurso (guía, lista, plantilla, clase)",
  gatillo: "empuja a agendar o comprar: caso de alumno o cliente, oferta o programa, respuesta a una objeción de compra, invitación a llamada o masterclass",
} as const
