# Imagem-base contendo SÓ as MIBs (~339 MB, ~570 diretórios de vendor).
#
# Por que existe: as MIBs ficam fora do git (.gitignore) para o repo não pesar,
# mas o backend precisa delas em BUILD-time (`COPY --from=mibs`). Antes, isso
# amarrava o build a uma máquina que tivesse a pasta provisionada em disco.
# Publicá-las como imagem resolve os dois lados — o repo continua leve e
# qualquer runner descartável (o ubuntu-latest do GitHub, inclusive) builda o
# backend sem provisionar nada.
#
# Como publicar (a partir de uma máquina que TENHA backend/mibs/):
#
#   cd backend
#   docker build -f mibs.Dockerfile -t registry.aurora.app.br/aurora-nettools/mibs:1 .
#   docker push registry.aurora.app.br/aurora-nettools/mibs:1
#
# Ao atualizar as MIBs, publique numa tag NOVA (`:2`, `:3`, ...) e aponte o
# ARG MIBS_IMAGE do backend/Dockerfile para ela. Nunca sobrescreva uma tag já
# publicada: o Dockerfile fixa a tag, então mexer nela mudaria retroativamente
# o conteúdo de imagens antigas e um rollback deixaria de reproduzir o que
# estava no ar.
#
# `scratch` porque isto não é uma imagem executável — é só um pacote de
# arquivos para o COPY --from. Sem SO embaixo, pesa exatamente o que as MIBs
# pesam e não carrega CVE de base.
FROM scratch
COPY mibs /mibs
