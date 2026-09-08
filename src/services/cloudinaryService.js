import { CLOUD_NAME, UPLOAD_PRESET } from './cloudinaryConfig'

export async function subirImagen(archivo) {
  if (!(archivo instanceof File) || !archivo.type.startsWith('image/')) {
    throw new TypeError('Debes seleccionar un archivo de imagen válido.')
  }

  if (!CLOUD_NAME || !UPLOAD_PRESET) {
    throw new Error('Falta configurar Cloudinary en las variables de entorno.')
  }

  const formData = new FormData()
  formData.append('file', archivo)
  formData.append('upload_preset', UPLOAD_PRESET)

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
    { method: 'POST', body: formData },
  )

  if (!response.ok) {
    const errorData = await response.json().catch(() => null)
    throw new Error(errorData?.error?.message || 'No se pudo subir la imagen a Cloudinary.')
  }

  const data = await response.json()

  // Esta URL puede guardarse desde el backend junto con los datos del producto.
  return data.secure_url
}
