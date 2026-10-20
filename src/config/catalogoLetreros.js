import image0 from '../assets/catalogo-pvc-acrilico-frontal.webp'
import image1 from '../assets/catalogo-acrilico-frontal.webp'
import image2 from '../assets/catalogo-pvc-retroiluminado.webp'
import image3 from '../assets/catalogo-aluminio-retroiluminado.webp'
import image4 from '../assets/catalogo-neon-logotipos.webp'
import image5 from '../assets/catalogo-neon-frases.webp'
import image6 from '../assets/catalogo-neon-siluetas.webp'
import image7 from '../assets/catalogo-neon-cuadros.webp'
import image8 from '../assets/catalogo-neon-alas.webp'
import image9 from '../assets/catalogo-espejos-infinitos.webp'

export const catalogSignGroups = [
  { id: "corporeas", title: "Letras corpóreas iluminadas", description: "Cuatro variantes que combinan material y dirección de la luz.", products: [
    { name: "PVC + acrílico con luz frontal", description: "Cuerpo de PVC pintado y frente de acrílico con vinil de color según el diseño. La luz LED sale por la cara frontal.", image: image0, colorA: '#24cbbb', colorB: '#12122c', caption: 'Fotografía del catálogo de Joker' },
    { name: "Acrílico con iluminación frontal", description: "Letras fabricadas en acrílico de color según el diseño, con iluminación LED. La difusión por el frente y los laterales se define al preparar la propuesta.", image: image1, colorA: '#24cbbb', colorB: '#12122c', caption: 'Fotografía del catálogo de Joker' },
    { name: "PVC retroiluminado", description: "Letras de PVC pintado con frente opaco y luz LED posterior que crea un halo sobre el muro. El color de la pared y la separación influyen en el efecto.", image: image2, colorA: '#24cbbb', colorB: '#12122c', caption: 'Fotografía del catálogo de Joker' },
    { name: "Aluminio retroiluminado", description: "Letras de aluminio con iluminación LED posterior. El acabado metálico y el color de la luz se eligen de acuerdo con la identidad de tu marca.", image: image3, colorA: '#24cbbb', colorB: '#12122c', caption: 'Fotografía del catálogo de Joker' },
  ] },
  { id: "neon", title: "Neón LED personalizado", description: "Logotipos, frases y figuras que se adaptan a tu espacio.", products: [
    { name: "Logotipos en neón LED", description: "Reproducimos los trazos de tu logo con neón LED flexible. Adaptamos tamaño, colores y soporte para conservar la lectura de la marca.", image: image4, colorA: '#24cbbb', colorB: '#12122c', caption: 'Fotografía del catálogo de Joker' },
    { name: "Frases en neón LED", description: "Nombres y mensajes luminosos para negocios, decoración y eventos. Personalizamos la composición, el color y las dimensiones.", image: image5, colorA: '#24cbbb', colorB: '#12122c', caption: 'Fotografía del catálogo de Joker' },
    { name: "Siluetas en neón LED", description: "Figuras y contornos luminosos para identificar ambientes o decorar espacios. La complejidad del dibujo determina el tamaño y el recorrido del neón.", image: image6, colorA: '#24cbbb', colorB: '#12122c', caption: 'Fotografía del catálogo de Joker' },
    { name: "Cuadros con neón LED", description: "Combinamos una imagen gráfica con trazos de neón LED para destacar formas, frases o detalles. Diseño y medidas según el espacio.", image: image7, colorA: '#24cbbb', colorB: '#12122c', caption: 'Fotografía del catálogo de Joker' },
    { name: "Alas para fotos en neón LED", description: "Alas luminosas para crear un punto de fotografías en locales y eventos. Definimos composición, colores y altura de colocación según el lugar.", image: image8, colorA: '#24cbbb', colorB: '#12122c', caption: 'Fotografía del catálogo de Joker' },
  ] },
  { id: "infinitos", title: "Espejos infinitos LED", description: "Profundidad y luz para destacar una marca o crear una pieza decorativa.", products: [
    { name: "Espejos infinitos LED", description: "Piezas decorativas y letreros con un efecto de profundidad formado por espejos e iluminación LED. Forma, tamaño y personalización según el proyecto.", image: image9, colorA: '#24cbbb', colorB: '#12122c', caption: 'Fotografía del catálogo de Joker' },
  ] },
]

export const catalogSigns = catalogSignGroups.flatMap((group) => group.products)
