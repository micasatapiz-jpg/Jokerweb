import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from './firebaseConfig'

const productosRef = collection(db, 'productos')

function mapearProductos(snapshot) {
  return snapshot.docs.map((documento) => ({
    id: documento.id,
    ...documento.data(),
  }))
}

export async function obtenerTodosLosProductos() {
  const snapshot = await getDocs(productosRef)
  return mapearProductos(snapshot)
}

export async function obtenerProductosPorCategoria(categoria) {
  const consulta = query(productosRef, where('categoria', '==', categoria))
  const snapshot = await getDocs(consulta)
  return mapearProductos(snapshot)
}

export async function obtenerProductosDestacados() {
  const consulta = query(productosRef, where('destacado', '==', true))
  const snapshot = await getDocs(consulta)
  return mapearProductos(snapshot)
}
