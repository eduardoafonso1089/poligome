import type { Language } from "../../lib/i18n";

const copy = {
  pt: {
    title: "Arraste imagens, anotações ou uma pasta",
    hint: "Solte aqui para importar. Os arquivos ficam no seu computador.",
    formats: "PNG, JPG, WebP, BMP, GIF · COCO / YOLO · .plgm",
    files: "Escolher arquivos", folder: "Escolher pasta", release: "Solte aqui para importar",
    busy: "Lendo arquivos…", failed: "Não foi possível ler os arquivos. Tente escolher os arquivos ou a pasta pelos botões.",
    empty: "Nenhum arquivo compatível encontrado. Use PNG, JPG, WebP, BMP, GIF, COCO, YOLO ou .plgm. Para GeoTIFF, use Arquivo › Abrir inteiro em blocos.",
    projectOnly: "Solte um único projeto .plgm separadamente dos outros arquivos.",
    needsImages: "Adicione também as imagens originais para associar as anotações.",
    dropHere: "Solte os arquivos na área de importação, no painel de imagens.",
    images: "{n} imagem(ns) carregada(s).", review: "Revise e confirme as anotações na janela de importação.",
    skipped: "{n} arquivo(s) de formato não suportado ignorado(s).", unreadable: "{n} imagem(ns) não puderam ser abertas.",
  },
  en: {
    title: "Drag images, annotations or a folder", hint: "Drop here to import. Files stay on your computer.",
    formats: "PNG, JPG, WebP, BMP, GIF · COCO / YOLO · .plgm", files: "Choose files", folder: "Choose folder", release: "Drop here to import",
    busy: "Reading files…", failed: "Could not read the files. Try choosing the files or folder with the buttons.",
    empty: "No supported files found. Use PNG, JPG, WebP, BMP, GIF, COCO, YOLO or .plgm. For GeoTIFF, use File › Open whole raster as tiles.",
    projectOnly: "Drop one .plgm project separately from other files.", needsImages: "Add the original images too so annotations can be matched.",
    dropHere: "Drop the files in the import area in the images panel.",
    images: "{n} image(s) loaded.", review: "Review and confirm annotations in the import window.", skipped: "{n} unsupported file(s) skipped.", unreadable: "{n} image(s) could not be opened.",
  },
  fr: {
    title: "Glissez des images, annotations ou un dossier", hint: "Déposez ici pour importer. Les fichiers restent sur votre ordinateur.",
    formats: "PNG, JPG, WebP, BMP, GIF · COCO / YOLO · .plgm", files: "Choisir des fichiers", folder: "Choisir un dossier", release: "Déposez ici pour importer",
    busy: "Lecture des fichiers…", failed: "Impossible de lire les fichiers. Utilisez les boutons pour choisir les fichiers ou le dossier.",
    empty: "Aucun fichier compatible. Utilisez PNG, JPG, WebP, BMP, GIF, COCO, YOLO ou .plgm. Pour GeoTIFF, utilisez le menu Fichier.",
    projectOnly: "Déposez un seul projet .plgm séparément des autres fichiers.", needsImages: "Ajoutez aussi les images originales pour associer les annotations.",
    dropHere: "Déposez les fichiers dans la zone d’importation du panneau des images.",
    images: "{n} image(s) chargée(s).", review: "Vérifiez et confirmez les annotations dans la fenêtre d’importation.", skipped: "{n} fichier(s) non compatible(s) ignoré(s).", unreadable: "{n} image(s) n’ont pas pu être ouvertes.",
  },
  es: {
    title: "Arrastra imágenes, anotaciones o una carpeta", hint: "Suelta aquí para importar. Los archivos se quedan en tu equipo.",
    formats: "PNG, JPG, WebP, BMP, GIF · COCO / YOLO · .plgm", files: "Elegir archivos", folder: "Elegir carpeta", release: "Suelta aquí para importar",
    busy: "Leyendo archivos…", failed: "No se pudieron leer los archivos. Usa los botones para elegir los archivos o la carpeta.",
    empty: "No hay archivos compatibles. Usa PNG, JPG, WebP, BMP, GIF, COCO, YOLO o .plgm. Para GeoTIFF, usa el menú Archivo.",
    projectOnly: "Suelta un solo proyecto .plgm por separado.", needsImages: "Añade también las imágenes originales para asociar las anotaciones.",
    dropHere: "Suelta los archivos en la zona de importación del panel de imágenes.",
    images: "{n} imagen(es) cargada(s).", review: "Revisa y confirma las anotaciones en la ventana de importación.", skipped: "{n} archivo(s) no compatible(s) omitido(s).", unreadable: "No se pudieron abrir {n} imagen(es).",
  },
};
export function fileDropCopy(language: Language) { return copy[language]; }
