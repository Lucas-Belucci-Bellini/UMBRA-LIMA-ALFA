# Catálogo K-map de quatro variáveis

A expansão adiciona **28.879 chips KMAP4**: as seis funções transcritas do quadro, mais 28.873 LUTs identificadas por máscara hexadecimal. O catálogo ULA completo passa a ter **30.000 arquivos JSON**.

## Ordem dos bits e nomes

As entradas são `A`, `B`, `C`, `D`; `A` é o bit menos significativo. Para o vetor de entrada, o índice da tabela-verdade é:

```text
índice = A + 2B + 4C + 8D
```

Em `KMAP4-LUT-XXXX`, `XXXX` é a máscara de 16 bits em hexadecimal. O bit `i` da máscara é a saída `F` para o índice `i`. Cada chip é implementado com o subchip `MUX-16` e as constantes lógicas `0` e `1`.

## Seis expressões do quadro

Convenções: `+` = OR, `·` = AND, barra = NOT.

| Chip | Função |
|---|---|
| `KMAP4-A` | `(D + C + B + Ā) · (C̄ + B + A)` |
| `KMAP4-B` | `(C̄ + B + Ā) · (C̄ + B̄ + A)` |
| `KMAP4-C` | `C + B̄ + A` |
| `KMAP4-D` | `(D + C + B + Ā) · (C̄ + B + A) · (C̄ + B̄ + Ā)` |
| `KMAP4-E` | `(C̄ · Ā) + (B · Ā)` |
| `KMAP4-F` | `(D + C · Ā) · (C + B̄) · (B + Ā)` |

A ordem exata de cada vetor e as seis máscaras correspondentes são cobertas por `tools/test-chips.js`.

## Geração e verificação

```bash
node tools/generate-chips.js
node tools/build-project-description.js
node tools/test-chips.js
node tools/verify-catalog.js
```

Os chips KMAP4 são gravados em lotes de 100 com JSON compacto. Arquivos existentes são preservados pelo gerador; isso evita reformatar ou reposicionar circuitos legados ao expandir o catálogo. A coleção `TIMERS` organiza os seis chips de atraso existentes; as coleções de registradores, contadores, flip-flops e os displays de sete segmentos permanecem disponíveis.
