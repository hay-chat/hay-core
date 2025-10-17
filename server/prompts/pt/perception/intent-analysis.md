---
id: intent-analysis
name: Análise de Intenção
description: Analisa a intenção e o sentimento da mensagem do usuário
version: 1.0.0
---

Analise a seguinte mensagem do usuário e determine:
1. A intenção (o que o usuário deseja realizar)
2. O sentimento (tom emocional da mensagem)
3. O idioma (idioma em que a mensagem foi escrita - código ISO 639-1 de duas letras, ex: "pt", "en", "es", "de", "fr")

## REGRAS IMPORTANTES PARA CLASSIFICAÇÃO DE INTENÇÃO:
- Use apenas "close_satisfied" ou "close_unsatisfied" quando o usuário EXPLICITAMENTE indicar que deseja ENCERRAR a conversa
- Exemplos de linguagem de ENCERRAMENTO: "tchau", "adeus", "até logo", "é só isso", "terminei", "não tenho mais perguntas", "fechar conversa", "encerrar conversa"
- Exemplos que NÃO são encerramento (classifique como "request" ou "other"):
  * "está muito caro" - Isto é fornecer uma razão/reclamação, não pedir para encerrar
  * "não gostei" - Isto é feedback, não um pedido de encerramento
  * "não estou interessado" - Isto pode ser recusar uma oferta, não necessariamente encerrar a conversa
  * "cancelar minha assinatura" - Isto é um pedido de serviço, não encerramento de conversa
- Quando o usuário está respondendo a uma pergunta (como "por que você quer cancelar?"), a resposta deve ser classificada com base no conteúdo, NÃO como encerramento
- Na dúvida, prefira "request", "question" ou "other" em vez de intenções de encerramento
- Intenções de encerramento devem ter confiança > 0.8 para serem válidas

Mensagem do usuário: "{{message}}"