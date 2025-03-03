import { ObjectExt } from '../util'
import { Rectangle } from '../geometry'
import { Background } from '../registry'
import { Base } from './base'

export class BackgroundManager extends Base {
  protected optionCache: BackgroundManager.Options | null

  protected get elem() {
    return this.view.background
  }

  protected init() {
    this.startListening()
    if (this.options.background) {
      this.draw(this.options.background)
    }
  }

  protected startListening() {
    this.graph.on('scale', this.update, this)
    this.graph.on('translate', this.update, this)
  }

  protected stopListening() {
    this.graph.off('scale', this.update, this)
    this.graph.off('translate', this.update, this)
  }

  protected updateBackgroundImage(options: BackgroundManager.Options = {}) {
    let backgroundSize: any = options.size || 'auto auto'
    let backgroundPosition: any = options.position || 'center'

    const scale = this.graph.transform.getScale()
    const ts = this.graph.translate()

    // backgroundPosition
    if (typeof backgroundPosition === 'object') {
      const x = ts.tx + scale.sx * (backgroundPosition.x || 0)
      const y = ts.ty + scale.sy * (backgroundPosition.y || 0)
      backgroundPosition = `${x}px ${y}px`
    }

    // backgroundSize
    if (typeof backgroundSize === 'object') {
      backgroundSize = Rectangle.fromSize(backgroundSize).scale(
        scale.sx,
        scale.sy,
      )
      backgroundSize = `${backgroundSize.width}px ${backgroundSize.height}px`
    }

    this.elem.style.backgroundSize = backgroundSize
    this.elem.style.backgroundPosition = backgroundPosition
  }

  protected drawBackgroundImage(
    img?: HTMLImageElement | null,
    options: BackgroundManager.Options = {},
  ) {
    if (!(img instanceof HTMLImageElement)) {
      this.elem.style.backgroundImage = ''
      return
    }

    let uri
    const opacity = options.opacity
    const backgroundSize: any = options.size
    let backgroundRepeat = options.repeat || 'no-repeat'

    const pattern = Background.registry.get(backgroundRepeat)
    if (typeof pattern === 'function') {
      const quality = (options as Background.ManaualItem).quality || 1
      img.width *= quality
      img.height *= quality
      const canvas = pattern(img, options)
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error(
          'Background pattern must return an HTML Canvas instance',
        )
      }

      uri = canvas.toDataURL('image/png')

      // `repeat` was changed in pattern function
      if (options.repeat && backgroundRepeat !== options.repeat) {
        backgroundRepeat = options.repeat
      } else {
        backgroundRepeat = 'repeat'
      }

      if (typeof backgroundSize === 'object') {
        // recalculate the tile size if an object passed in
        backgroundSize.width *= canvas.width / img.width
        backgroundSize.height *= canvas.height / img.height
      } else if (backgroundSize === undefined) {
        // calcule the tile size if no provided
        options.size = {
          width: canvas.width / quality,
          height: canvas.height / quality,
        }
      }
    } else {
      uri = img.src
      if (backgroundSize === undefined) {
        options.size = {
          width: img.width,
          height: img.height,
        }
      }
    }

    const style = this.elem.style
    style.backgroundRepeat = backgroundRepeat
    style.backgroundImage = `url(${uri})`
    style.opacity = opacity == null || opacity >= 1 ? '' : `${opacity}`

    this.updateBackgroundImage(options)
  }

  protected updateBackgroundColor(color?: string | null) {
    this.elem.style.backgroundColor = color || ''
  }

  protected updateBackgroundOptions(options?: BackgroundManager.Options) {
    this.graph.options.background = options
  }

  update() {
    if (this.optionCache) {
      this.updateBackgroundImage(this.optionCache)
    }
  }

  draw(options?: BackgroundManager.Options) {
    this.updateBackgroundOptions(options)
    const localOptions = options || {}
    this.updateBackgroundColor(localOptions.color)

    if (localOptions.image) {
      const img = document.createElement('img')
      img.onload = () => this.drawBackgroundImage(img, options)
      img.setAttribute('crossorigin', 'anonymous')
      img.src = localOptions.image
      this.optionCache = ObjectExt.clone(localOptions)
    } else {
      this.drawBackgroundImage(null)
      this.optionCache = null
    }
  }

  clear() {
    this.draw()
  }

  @Base.dispose()
  dispose() {
    this.clear()
    this.stopListening()
  }
}

export namespace BackgroundManager {
  export type Options =
    | Background.Options
    | Background.NativeItem
    | Background.ManaualItem
}
