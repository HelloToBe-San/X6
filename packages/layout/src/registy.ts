import { GridLayout } from './layout'

const map: Map<string, any> = new Map()

export const registLayout = (name: string, customClass: any) => {
  if (map.get(name)) {
    throw new Error('already have a layout with the same name')
  }
  map.set(name, customClass)
}

export const unRegistLayout = (name: string) => {
  if (map.has(name)) {
    map.delete(name)
  }
}

export const getLayoutByName = (name: string) => {
  if (map.has(name)) {
    return map.get(name)
  }
  return null
}

registLayout('grid', GridLayout)

export type LayoutOptions = GridLayout.GridLayoutOptions
