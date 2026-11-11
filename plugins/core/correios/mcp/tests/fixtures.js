/**
 * SRO Rastro and Token API payloads in the shape of the public OpenAPI
 * documents (srorastro/v3/api-docs, token/v3/api-docs). Invented data.
 */

function makeEvent(overrides = {}) {
  return {
    codigo: "RO",
    tipo: "01",
    dtHrCriado: "2026-10-20T10:00:00",
    descricao: "Objeto em transferência - por favor aguarde",
    unidade: { tipo: "Unidade de Tratamento", endereco: { cidade: "CURITIBA", uf: "PR" } },
    unidadeDestino: {
      tipo: "Unidade de Distribuição",
      endereco: { cidade: "SAO PAULO", uf: "SP" },
    },
    ...overrides,
  };
}

const POSTED = makeEvent({
  codigo: "PO",
  dtHrCriado: "2026-10-15T09:30:00",
  descricao: "Objeto postado",
  unidade: { tipo: "Agência dos Correios", endereco: { cidade: "CURITIBA", uf: "PR" } },
  unidadeDestino: undefined,
});

const DELIVERED = makeEvent({
  codigo: "BDE",
  tipo: "01",
  dtHrCriado: "2026-10-22T14:05:00",
  descricao: "Objeto entregue ao destinatário",
  unidade: { tipo: "Unidade de Distribuição", endereco: { cidade: "SAO PAULO", uf: "SP" } },
  unidadeDestino: undefined,
  // Personal data Correios sends with a delivery; must never reach the result.
  recebedor: { nome: "MARIA DA SILVA", documento: "12345678900" },
});

function makeSro(code, eventos, overrides = {}) {
  return {
    versao: "1.0.0",
    quantidade: 1,
    objetos: [
      {
        codObjeto: code,
        tipoPostal: { sigla: code.slice(0, 2), nome: "ETIQUETA LOGICA SEDEX", categoria: "SEDEX" },
        dtPrevista: "2026-10-23T23:59:59",
        eventos,
        ...overrides,
      },
    ],
    tipoResultado: "Todos os Eventos",
  };
}

function makeToken(overrides = {}) {
  return {
    ambiente: "PRODUCAO",
    id: "12345678000190",
    emissao: "2026-10-28T09:00:00",
    expiraEm: "2026-10-29T09:00:00",
    zoneOffset: "-03:00",
    token: "tok-1",
    ...overrides,
  };
}

module.exports = { makeEvent, makeSro, makeToken, POSTED, DELIVERED };
