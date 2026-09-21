# Contêiner BYOM de referência do Poligome.
#
# O contrato imita o do SageMaker: a imagem é iniciada com o argumento `serve`,
# escuta na porta 8080, responde GET /ping quando está pronta e recebe a
# inferência em POST /invocations. Os pesos ficam em /opt/ml/model.
#
# Construir:  docker build -t poligome-byom-exemplo public/byom
# Executar:   docker run --rm -p 8080:8080 poligome-byom-exemplo serve
# A base é fixada por digest, e não pela tag: a tag 3.12-slim é reescrita a cada
# atualização do Debian, e sem o digest uma reconstrução meses depois produziria
# outra imagem. É isso que garante que o exemplo continue existindo igual, sem
# precisar versionar os 347 MB do tarball.
FROM python:3.12-slim@sha256:2c941e860699f878900b0edc2403613c234d4b32eda3cc9fa7036991a2a63c4a

# O OpenCV headless evita as bibliotecas de interface gráfica, que não existem
# na imagem slim e não servem para nada dentro de um contêiner de inferência.
RUN pip install --no-cache-dir \
      "numpy==2.2.6" \
      "opencv-python-headless==4.11.0.86" \
      "pillow==11.3.0"

# Mesmo caminho do SageMaker: monte um volume aqui para trocar de pesos sem
# reconstruir a imagem, com `docker run -v "$PWD/pesos:/opt/ml/model"`.
RUN mkdir -p /opt/ml/model
ENV MODEL_DIR=/opt/ml/model
ENV PORT=8080

COPY serve.py /opt/program/serve.py
WORKDIR /opt/program

EXPOSE 8080

# ENTRYPOINT com o script e CMD com o comando reproduz o `docker run <imagem>
# serve` esperado pelo contrato.
ENTRYPOINT ["python", "/opt/program/serve.py"]
CMD ["serve"]
