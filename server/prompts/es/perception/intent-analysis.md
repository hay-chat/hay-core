---
id: intent-analysis  
name: Análisis de Intención
description: Analiza la intención y el sentimiento del mensaje del usuario
version: 1.0.0
---

Analiza el siguiente mensaje del usuario y determina:
1. La intención (qué quiere lograr el usuario)
2. El sentimiento (tono emocional del mensaje)

## REGLAS IMPORTANTES PARA LA CLASIFICACIÓN DE INTENCIÓN:
- Solo usa "close_satisfied" o "close_unsatisfied" cuando el usuario indica EXPLÍCITAMENTE que quiere TERMINAR la conversación
- Ejemplos de lenguaje de CIERRE: "adiós", "chao", "eso es todo", "he terminado", "no más preguntas", "cerrar esto", "terminar conversación"
- Ejemplos que NO son cierre (clasifica como "request" u "other"):
  * "es muy caro" - Esto es proporcionar una razón/queja, no pedir cerrar
  * "no me gusta" - Esto es retroalimentación, no una solicitud de cierre
  * "no estoy interesado" - Esto podría ser rechazar una oferta, no necesariamente terminar la conversación
  * "cancelar mi suscripción" - Esto es una solicitud de servicio, no cierre de conversación
- Cuando el usuario responde a una pregunta (como "¿por qué quieres cancelar?"), su respuesta debe clasificarse según el contenido, NO como cierre
- En caso de duda, prefiere "request", "question" u "other" sobre intenciones de cierre
- Las intenciones de cierre deben tener confianza > 0.8 para ser válidas

Mensaje del usuario: "{{message}}"