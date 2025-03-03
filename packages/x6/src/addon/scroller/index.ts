import { Point, Rectangle } from '../../geometry'
import { Platform, NumberExt, ObjectExt, Dom, FunctionExt } from '../../util'
import { Model } from '../../model/model'
import { Cell } from '../../model/cell'
import { View } from '../../view/view'
import { Graph } from '../../graph'
import { Renderer } from '../../graph/renderer'
import { GraphView } from '../../graph/view'
import { EventArgs } from '../../graph/events'
import { TransformManager } from '../../graph/transform'
import { BackgroundManager } from '../../graph/background'

export class Scroller extends View {
  public readonly options: Scroller.Options
  public readonly container: HTMLDivElement
  public readonly content: HTMLDivElement
  public readonly background: HTMLDivElement
  public readonly $container: JQuery<HTMLElement>
  public readonly backgroundManager: Scroller.Background
  protected readonly $background: JQuery<HTMLElement>
  protected readonly $content: JQuery<HTMLElement>
  protected pageBreak: HTMLDivElement

  public get graph() {
    return this.options.graph
  }

  public get model() {
    return this.graph.model
  }

  protected sx: number
  protected sy: number
  protected clientX: number
  protected clientY: number
  protected padding = { left: 0, top: 0, right: 0, bottom: 0 }
  protected cachedScrollLeft: number | null
  protected cachedScrollTop: number | null
  protected cachedCenterPoint: Point.PointLike | null
  protected delegatedHandlers: { [name: string]: Function }

  constructor(options: Scroller.Options) {
    super()

    this.options = Util.getOptions(options)

    const scale = this.graph.transform.getScale()
    this.sx = scale.sx
    this.sy = scale.sy

    const width = this.options.width || this.graph.options.width
    const height = this.options.height || this.graph.options.height
    this.container = document.createElement('div')
    this.$container = this.$(this.container)
      .addClass(this.prefixClassName(Util.containerClass))
      .css({ width, height })

    if (this.options.pageVisible) {
      this.$container.addClass(this.prefixClassName(Util.pagedClass))
    }

    if (this.options.className) {
      this.$container.addClass(this.options.className)
    }

    const graph = this.graph
    const graphContainer = graph.container

    if (graphContainer.parentNode) {
      this.$container.insertBefore(graphContainer)
    }

    // copy style
    // const style = graphContainer.getAttribute('style')
    // if (style) {
    //   graphContainer.removeAttribute('style')
    //   this.container.setAttribute('style', style)
    // }

    this.content = document.createElement('div')
    this.$content = this.$(this.content)
      .addClass(this.prefixClassName(Util.contentClass))
      .css({
        width: graph.options.width,
        height: graph.options.height,
      })

    // custom background
    this.background = document.createElement('div')
    this.$background = this.$(this.background).addClass(
      this.prefixClassName(Util.backgroundClass),
    )
    this.$content.append(this.background)

    if (!this.options.pageVisible) {
      this.$content.append(this.graph.view.grid)
    }
    this.$content.append(graphContainer)
    this.$content.appendTo(this.container)

    this.startListening()

    if (!this.options.pageVisible) {
      this.graph.grid.update()
    }

    this.backgroundManager = new Scroller.Background(this)
  }

  protected startListening() {
    const graph = this.graph
    const model = this.model

    graph.on('scale', this.onScale, this)
    graph.on('resize', this.onResize, this)
    graph.on('before:print', this.storeScrollPosition, this)
    graph.on('before:export', this.storeScrollPosition, this)
    graph.on('after:print', this.restoreScrollPosition, this)
    graph.on('after:export', this.restoreScrollPosition, this)

    if (this.options.autoResize) {
      if (graph.renderer.isAsync()) {
        graph.on('render:done', this.onRenderDone, this)
      } else {
        graph.on('unfreeze', this.update, this)
        model.on('reseted', this.update, this)
        model.on('cell:added', this.update, this)
        model.on('cell:removed', this.update, this)
        model.on('cell:changed', this.update, this)
        model.on('batch:stop', this.onBatchStop, this)
      }
    }
    this.delegateBackgroundEvents()
  }

  protected stopListening() {
    const graph = this.graph
    const model = this.model

    graph.off('scale', this.onScale, this)
    graph.off('resize', this.onResize, this)
    graph.off('beforeprint', this.storeScrollPosition, this)
    graph.off('beforeexport', this.storeScrollPosition, this)
    graph.off('afterprint', this.restoreScrollPosition, this)
    graph.off('afterexport', this.restoreScrollPosition, this)

    graph.off('render:done', this.onRenderDone, this)

    graph.off('unfreeze', this.update, this)
    model.off('reseted', this.update, this)
    model.off('cell:added', this.update, this)
    model.off('cell:removed', this.update, this)
    model.off('cell:changed', this.update, this)
    model.off('batch:stop', this.onBatchStop, this)
    this.undelegateBackgroundEvents()
  }

  protected delegateBackgroundEvents(events?: View.Events) {
    const evts = events || GraphView.events
    this.delegatedHandlers = Object.keys(evts).reduce<{
      [name: string]: Function
    }>((memo, name) => {
      const handler = evts[name]
      if (name.indexOf(' ') === -1) {
        if (typeof handler === 'function') {
          memo[name] = handler
        } else {
          let method = this.graph.view[handler as keyof GraphView]
          if (typeof method === 'function') {
            method = method.bind(this.graph.view)
            memo[name] = method as Function
          }
        }
      }
      return memo
    }, {})

    this.onBackgroundEvent = this.onBackgroundEvent.bind(this)
    Object.keys(this.delegatedHandlers).forEach((name) => {
      this.delegateEvent(
        name,
        {
          guarded: false,
        },
        this.onBackgroundEvent,
      )
    })
  }

  protected undelegateBackgroundEvents() {
    Object.keys(this.delegatedHandlers).forEach((name) => {
      this.undelegateEvent(name, this.onBackgroundEvent)
    })
  }

  protected onBackgroundEvent(e: JQuery.TriggeredEvent) {
    let shouldHnadleEvent = false

    const target = e.target

    if (!this.options.pageVisible) {
      shouldHnadleEvent =
        this.graph.view.background === target || this.graph.view.grid === target
    } else if (this.options.background) {
      shouldHnadleEvent = this.background === target
    } else {
      shouldHnadleEvent = this.content === target
    }

    if (shouldHnadleEvent) {
      const handler = this.delegatedHandlers[e.type]
      if (typeof handler === 'function') {
        handler.apply(this.graph, arguments)
      }
    }
  }

  protected onRenderDone({ stats }: EventArgs['render:done']) {
    if (stats.priority < 2) {
      this.update()
    }
  }

  protected onResize() {
    if (this.cachedCenterPoint) {
      this.centerPoint(this.cachedCenterPoint.x, this.cachedCenterPoint.y)
      this.updatePageBreak()
    }
  }

  protected onScale({ sx, sy, ox, oy }: EventArgs['scale']) {
    this.updateScale(sx, sy)

    if (ox || oy) {
      this.centerPoint(ox, oy)
      this.updatePageBreak()
    }

    if (typeof this.options.fitTocontentOptions === 'function') {
      this.update()
    }
  }

  protected storeScrollPosition() {
    this.cachedScrollLeft = this.container.scrollLeft
    this.cachedScrollTop = this.container.scrollTop
  }

  protected restoreScrollPosition() {
    this.container.scrollLeft = this.cachedScrollLeft!
    this.container.scrollTop = this.cachedScrollTop!
    this.cachedScrollLeft = null
    this.cachedScrollTop = null
  }

  protected beforeManipulation() {
    if (Platform.IS_IE || Platform.IS_EDGE) {
      this.$container.css('visibility', 'hidden')
    }
  }

  protected afterManipulation() {
    if (Platform.IS_IE || Platform.IS_EDGE) {
      this.$container.css('visibility', 'visible')
    }
  }

  protected updatePageBreak() {
    if (this.pageBreak && this.pageBreak.parentNode) {
      this.pageBreak.parentNode.removeChild(this.pageBreak)
    }

    const options = this.options
    if (options.pageVisible && options.pageBreak) {
      const graphWidth = Math.round(this.graph.options.width / this.sx)
      const graphHeight = Math.round(this.graph.options.height / this.sy)
      const pageWidth = options.pageWidth || graphWidth
      const pageHeight = options.pageHeight || graphHeight
      if (graphWidth > pageWidth || graphHeight > pageHeight) {
        this.pageBreak = document.createElement('div')
        Dom.addClass(this.pageBreak, this.prefixClassName('graph-pagebreak'))
        this.$(this.graph.view.grid).after(this.pageBreak)

        for (let i = 1, l = Math.floor(graphWidth / pageWidth); i < l; i += 1) {
          this.$('<div/>')
            .addClass(this.prefixClassName(`graph-pagebreak-vertical`))
            .css({
              left: i * pageWidth,
            })
            .appendTo(this.pageBreak)
        }

        for (
          let i = 1, l = Math.floor(graphHeight / pageHeight);
          i < l;
          i += 1
        ) {
          this.$('<div/>')
            .addClass(this.prefixClassName(`graph-pagebreak-horizontal`))
            .css({
              top: i * pageHeight,
            })
            .appendTo(this.pageBreak)
        }
      }
    }
  }

  onBatchStop(args: { name: Model.BatchName }) {
    if (Renderer.UPDATE_DELAYING_BATCHES.includes(args.name)) {
      this.update()
    }
  }

  update() {
    const size = this.getClientSize()
    this.cachedCenterPoint = this.clientToLocalPoint(
      size.width / 2,
      size.height / 2,
    )
    let fitTocontentOptions = this.options.fitTocontentOptions
    if (typeof fitTocontentOptions === 'function') {
      fitTocontentOptions = FunctionExt.call(fitTocontentOptions, this, this)
    }

    const options: TransformManager.FitToContentFullOptions = {
      gridWidth: this.options.pageWidth,
      gridHeight: this.options.pageHeight,
      allowNewOrigin: 'negative',
      ...fitTocontentOptions,
    }
    this.graph.fitToContent(this.getFitToContentOptions(options))
  }

  protected getFitToContentOptions(
    options: TransformManager.FitToContentFullOptions,
  ) {
    const sx = this.sx
    const sy = this.sy

    options.gridWidth && (options.gridWidth *= sx)
    options.gridHeight && (options.gridHeight *= sy)
    options.minWidth && (options.minWidth *= sx)
    options.minHeight && (options.minHeight *= sy)

    if (typeof options.padding === 'object') {
      options.padding = {
        left: (options.padding.left || 0) * sx,
        right: (options.padding.right || 0) * sx,
        top: (options.padding.top || 0) * sy,
        bottom: (options.padding.bottom || 0) * sy,
      }
    } else if (typeof options.padding === 'number') {
      options.padding = options.padding * sx
    }

    return options
  }

  protected updateScale(sx: number, sy: number) {
    const options = this.graph.options

    const dx = sx / this.sx
    const dy = sy / this.sy

    this.sx = sx
    this.sy = sy

    this.graph.translate(options.x * dx, options.y * dy)
    this.graph.resizeGraph(options.width * dx, options.height * dy)
  }

  scrollbarPosition(): { left: number; top: number }
  scrollbarPosition(
    left?: number,
    top?: number,
    options?: Scroller.ScrollOptions,
  ): this
  scrollbarPosition(
    left?: number,
    top?: number,
    options?: Scroller.ScrollOptions,
  ) {
    if (left == null && top == null) {
      return {
        left: this.container.scrollLeft,
        top: this.container.scrollTop,
      }
    }

    const prop: { [key: string]: number } = {}
    if (typeof left === 'number') {
      prop.scrollLeft = left
    }

    if (typeof top === 'number') {
      prop.scrollTop = top
    }

    if (options && options.animation) {
      this.$container.animate(prop, options.animation)
    } else {
      this.$container.prop(prop)
    }

    return this
  }

  /**
   * Try to scroll to ensure that the position (x,y) on the graph (in local
   * coordinates) is at the center of the viewport. If only one of the
   * coordinates is specified, only scroll in the specified dimension and
   * keep the other coordinate unchanged.
   */
  scrollToPoint(
    x: number | null | undefined,
    y: number | null | undefined,
    options?: Scroller.ScrollOptions,
  ) {
    const size = this.getClientSize()
    const ctm = this.graph.matrix()
    const prop: { [key: string]: number } = {}

    if (typeof x === 'number') {
      prop.scrollLeft = x - size.width / 2 + ctm.e + (this.padding.left || 0)
    }

    if (typeof y === 'number') {
      prop.scrollTop = y - size.height / 2 + ctm.f + (this.padding.top || 0)
    }

    if (options && options.animation) {
      this.$container.animate(prop, options.animation)
    } else {
      this.$container.prop(prop)
    }

    return this
  }

  /**
   * Try to scroll to ensure that the center of graph content is at the
   * center of the viewport.
   */
  scrollToContent(options?: Scroller.ScrollOptions) {
    const sx = this.sx
    const sy = this.sy
    const center = this.graph.getContentArea().getCenter()
    return this.scrollToPoint(center.x * sx, center.y * sy, options)
  }

  /**
   * Try to scroll to ensure that the center of cell is at the center of
   * the viewport.
   */
  scrollToCell(cell: Cell, options?: Scroller.ScrollOptions) {
    const sx = this.sx
    const sy = this.sy
    const center = cell.getBBox().getCenter()
    return this.scrollToPoint(center.x * sx, center.y * sy, options)
  }

  /**
   * The center methods are more aggressive than the scroll methods. These
   * methods position the graph so that a specific point on the graph lies
   * at the center of the viewport, adding paddings around the paper if
   * necessary (e.g. if the requested point lies in a corner of the paper).
   * This means that the requested point will always move into the center
   * of the viewport. (Use the scroll functions to avoid adding paddings
   * and only scroll the viewport as far as the graph boundary.)
   */

  /**
   * Position the center of graph to the center of the viewport.
   */
  center(optons?: Scroller.CenterOptions) {
    return this.centerPoint(optons)
  }

  /**
   * Position the point (x,y) on the graph (in local coordinates) to the
   * center of the viewport. If only one of the coordinates is specified,
   * only center along the specified dimension and keep the other coordinate
   * unchanged.
   */
  centerPoint(
    x: number,
    y: null | number,
    options?: Scroller.CenterOptions,
  ): this
  centerPoint(
    x: null | number,
    y: number,
    options?: Scroller.CenterOptions,
  ): this
  centerPoint(optons?: Scroller.CenterOptions): this
  centerPoint(
    x?: number | null | Scroller.CenterOptions,
    y?: number | null,
    options?: Scroller.CenterOptions,
  ) {
    const ctm = this.graph.matrix()
    const sx = ctm.a
    const sy = ctm.d
    const tx = -ctm.e
    const ty = -ctm.f
    const tWidth = tx + this.graph.options.width
    const tHeight = ty + this.graph.options.height

    let localOptions: Scroller.CenterOptions | null | undefined

    if (typeof x === 'number' || typeof y === 'number') {
      localOptions = options
      const visibleCenter = this.getVisibleArea().getCenter()
      if (typeof x === 'number') {
        x = x * sx // tslint:disable-line
      } else {
        x = visibleCenter.x // tslint:disable-line
      }

      if (typeof y === 'number') {
        y = y * sy // tslint:disable-line
      } else {
        y = visibleCenter.y // tslint:disable-line
      }
    } else {
      localOptions = x
      x = (tx + tWidth) / 2 // tslint:disable-line
      y = (ty + tHeight) / 2 // tslint:disable-line
    }

    if (localOptions && localOptions.padding) {
      return this.positionPoint({ x, y }, '50%', '50%', localOptions)
    }

    const padding = this.getPadding()
    const clientSize = this.getClientSize()
    const cx = clientSize.width / 2
    const cy = clientSize.height / 2
    const left = cx - padding.left - x + tx
    const right = cx - padding.right + x - tWidth
    const top = cy - padding.top - y + ty
    const bottom = cy - padding.bottom + y - tHeight

    this.addPadding(
      Math.max(left, 0),
      Math.max(right, 0),
      Math.max(top, 0),
      Math.max(bottom, 0),
    )

    return this.scrollToPoint(x, y, localOptions || undefined)
  }

  centerContent(options?: Scroller.PositionContentOptions) {
    return this.positionContent('center', options)
  }

  centerCell(cell: Cell, options?: Scroller.CenterOptions) {
    return this.positionCell(cell, 'center', options)
  }

  /**
   * The position methods are a more general version of the center methods.
   * They position the graph so that a specific point on the graph lies at
   * requested coordinates inside the viewport.
   */

  /**
   *
   */
  positionContent(
    pos: Scroller.Direction,
    options?: Scroller.PositionContentOptions,
  ) {
    const rect = this.graph.getContentArea(options)
    return this.positionRect(rect, pos, options)
  }

  positionCell(
    cell: Cell,
    pos: Scroller.Direction,
    options?: Scroller.CenterOptions,
  ) {
    const bbox = cell.getBBox()
    return this.positionRect(bbox, pos, options)
  }

  positionRect(
    rect: Rectangle.RectangleLike,
    pos: Scroller.Direction,
    options?: Scroller.CenterOptions,
  ) {
    const bbox = Rectangle.create(rect)
    switch (pos) {
      case 'center':
        return this.positionPoint(bbox.getCenter(), '50%', '50%', options)
      case 'top':
        return this.positionPoint(bbox.getTopCenter(), '50%', 0, options)
      case 'top-right':
        return this.positionPoint(bbox.getTopRight(), '100%', 0, options)
      case 'right':
        return this.positionPoint(bbox.getRightMiddle(), '100%', '50%', options)
      case 'bottom-right':
        return this.positionPoint(
          bbox.getBottomRight(),
          '100%',
          '100%',
          options,
        )
      case 'bottom':
        return this.positionPoint(
          bbox.getBottomCenter(),
          '50%',
          '100%',
          options,
        )
      case 'bottom-left':
        return this.positionPoint(bbox.getBottomLeft(), 0, '100%', options)
      case 'left':
        return this.positionPoint(bbox.getLeftMiddle(), 0, '50%', options)
      case 'top-left':
        return this.positionPoint(bbox.getTopLeft(), 0, 0, options)
      default:
        return this
    }
  }

  positionPoint(
    point: Point.PointLike,
    x: number | string,
    y: number | string,
    options: Scroller.CenterOptions = {},
  ) {
    const { padding: pad, ...localOptions } = options
    const padding = NumberExt.normalizeSides(pad)
    const clientRect = Rectangle.fromSize(this.getClientSize())
    const targetRect = clientRect.clone().moveAndExpand({
      x: padding.left,
      y: padding.top,
      width: -padding.right - padding.left,
      height: -padding.top - padding.bottom,
    })

    // tslint:disable-next-line
    x = NumberExt.normalizePercentage(x, Math.max(0, targetRect.width))
    if (x < 0) {
      x = targetRect.width + x // tslint:disable-line
    }

    // tslint:disable-next-line
    y = NumberExt.normalizePercentage(y, Math.max(0, targetRect.height))
    if (y < 0) {
      y = targetRect.height + y // tslint:disable-line
    }

    const origin = targetRect.getTopLeft().translate(x, y)
    const diff = clientRect.getCenter().diff(origin)
    const scale = this.zoom()
    const rawDiff = diff.scale(1 / scale, 1 / scale)
    const result = Point.create(point).translate(rawDiff)
    return this.centerPoint(result.x, result.y, localOptions)
  }

  zoom(): number
  zoom(factor: number, options?: TransformManager.ZoomOptions): this
  zoom(factor?: number, options?: TransformManager.ZoomOptions) {
    if (factor == null) {
      return this.sx
    }

    options = options || {} // tslint:disable-line

    let cx
    let cy
    const clientSize = this.getClientSize()
    const center = this.clientToLocalPoint(
      clientSize.width / 2,
      clientSize.height / 2,
    )

    let sx = factor
    let sy = factor

    if (!options.absolute) {
      sx = sx + this.sx
      sy = sy + this.sy
    }

    if (options.scaleGrid) {
      sx = Math.round(sx / options.scaleGrid) * options.scaleGrid
      sy = Math.round(sy / options.scaleGrid) * options.scaleGrid
    }

    if (options.maxScale) {
      sx = Math.min(options.maxScale, sx)
      sy = Math.min(options.maxScale, sy)
    }

    if (options.minScale) {
      sx = Math.max(options.minScale, sx)
      sy = Math.max(options.minScale, sy)
    }

    sx = this.graph.transform.clampScale(sx)
    sy = this.graph.transform.clampScale(sy)

    if (options.center) {
      const fx = sx / this.sx
      const fy = sy / this.sy
      cx = options.center.x - (options.center.x - center.x) / fx
      cy = options.center.y - (options.center.y - center.y) / fy
    } else {
      cx = center.x
      cy = center.y
    }

    this.beforeManipulation()
    this.graph.transform.scale(sx, sy)
    this.centerPoint(cx, cy)
    this.afterManipulation()

    return this
  }

  zoomToRect(
    rect: Rectangle.RectangleLike,
    options: TransformManager.ScaleContentToFitOptions = {},
  ) {
    const area = Rectangle.create(rect)
    const graph = this.graph

    options.contentArea = area
    if (options.viewportArea == null) {
      options.viewportArea = {
        x: graph.options.x,
        y: graph.options.y,
        width: this.$container.width()!,
        height: this.$container.height()!,
      }
    }

    this.beforeManipulation()
    graph.transform.scaleContentToFitImpl(options, false)
    const center = area.getCenter()
    this.centerPoint(center.x, center.y)
    this.afterManipulation()

    return this
  }

  zoomToFit(
    options: TransformManager.GetContentAreaOptions &
      TransformManager.ScaleContentToFitOptions = {},
  ) {
    return this.zoomToRect(this.graph.getContentArea(options), options)
  }

  transitionToPoint(
    p: Point.PointLike,
    options?: Scroller.TransitionOptions,
  ): this
  transitionToPoint(
    x: number,
    y: number,
    options?: Scroller.TransitionOptions,
  ): this
  transitionToPoint(
    x: number | Point.PointLike,
    y?: number | Scroller.TransitionOptions,
    options?: Scroller.TransitionOptions,
  ) {
    if (typeof x === 'object') {
      options = y as Scroller.TransitionOptions // tslint:disable-line
      y = x.y // tslint:disable-line
      x = x.x // tslint:disable-line
    } else {
      y = y as number // tslint:disable-line
    }

    if (options == null) {
      options = {} // tslint:disable-line
    }

    let transform
    let transformOrigin
    const scale = this.sx
    const targetScale = Math.max(options.scale || scale, 0.000001)
    const clientSize = this.getClientSize()
    const targetPoint = new Point(x, y)
    const localPoint = this.clientToLocalPoint(
      clientSize.width / 2,
      clientSize.height / 2,
    )

    if (scale === targetScale) {
      const translate = localPoint.diff(targetPoint).scale(scale, scale).round()
      transform = `translate(${translate.x}px,${translate.y}px)`
    } else {
      const delta =
        (targetScale / (scale - targetScale)) * targetPoint.distance(localPoint)
      const range = localPoint.clone().move(targetPoint, delta)
      const origin = this.localToBackgroundPoint(range).round()
      transform = `scale(${targetScale / scale})`
      transformOrigin = `${origin.x}px ${origin.y}px`
    }

    const onTransitionEnd = options.onTransitionEnd
    this.$container.addClass(Util.transitionClassName)
    this.$content
      .off(Util.transitionEventName)
      .on(Util.transitionEventName, (e) => {
        this.syncTransition(targetScale, { x: x as number, y: y as number })
        if (typeof onTransitionEnd === 'function') {
          FunctionExt.call(
            onTransitionEnd,
            this,
            e.originalEvent as TransitionEvent,
          )
        }
      })
      .css({
        transform,
        transformOrigin,
        transition: 'transform',
        transitionDuration: options.duration || '1s',
        transitionDelay: options.delay,
        transitionTimingFunction: options.timing,
      } as JQuery.PlainObject<string>)

    return this
  }

  protected syncTransition(scale: number, p: Point.PointLike) {
    this.beforeManipulation()
    this.graph.scale(scale)
    this.removeTransition()
    this.centerPoint(p.x, p.y)
    this.afterManipulation()
    return this
  }

  protected removeTransition() {
    this.$container.removeClass(Util.transitionClassName)
    this.$content.off(Util.transitionEventName).css({
      transform: '',
      transformOrigin: '',
      transition: '',
      transitionDuration: '',
      transitionDelay: '',
      transitionTimingFunction: '',
    })
    return this
  }

  transitionToRect(
    rectangle: Rectangle.RectangleLike,
    options: Scroller.TransitionToRectOptions = {},
  ) {
    const rect = Rectangle.create(rectangle)
    const maxScale = options.maxScale || Infinity
    const minScale = options.minScale || Number.MIN_VALUE
    const scaleGrid = options.scaleGrid || null
    const PIXEL_SIZE = options.visibility || 1
    const center = options.center
      ? Point.create(options.center)
      : rect.getCenter()
    const clientSize = this.getClientSize()
    const w = clientSize.width * PIXEL_SIZE
    const h = clientSize.height * PIXEL_SIZE
    let scale = new Rectangle(
      center.x - w / 2,
      center.y - h / 2,
      w,
      h,
    ).getMaxUniformScaleToFit(rect, center)

    scale = Math.min(scale, maxScale)
    if (scaleGrid) {
      scale = Math.floor(scale / scaleGrid) * scaleGrid
    }
    scale = Math.max(minScale, scale)

    return this.transitionToPoint(center, {
      scale,
      ...options,
    })
  }

  startPanning(evt: JQuery.MouseDownEvent) {
    const e = this.normalizeEvent(evt)
    this.clientX = e.clientX
    this.clientY = e.clientY
    this.trigger('pan:start', { e })
    this.$(document.body).on({
      'mousemove.panning touchmove.panning': this.pan.bind(this),
      'mouseup.panning touchend.panning': this.stopPanning.bind(this),
    })
    this.$(window).on('mouseup.panning', this.stopPanning.bind(this))
  }

  pan(evt: JQuery.MouseMoveEvent) {
    const e = this.normalizeEvent(evt)
    const dx = e.clientX - this.clientX
    const dy = e.clientY - this.clientY
    this.container.scrollTop -= dy
    this.container.scrollLeft -= dx
    this.clientX = e.clientX
    this.clientY = e.clientY
  }

  stopPanning(e: JQuery.MouseUpEvent) {
    this.$(document.body).off('.panning')
    this.$(window).off('.panning')
    this.trigger('pan:stop', { e })
  }

  clientToLocalPoint(p: Point.PointLike): Point
  clientToLocalPoint(x: number, y: number): Point
  clientToLocalPoint(a: number | Point.PointLike, b?: number) {
    let x = typeof a === 'object' ? a.x : a
    let y = typeof a === 'object' ? a.y : (b as number)

    const ctm = this.graph.matrix()

    x += this.container.scrollLeft - this.padding.left - ctm.e
    y += this.container.scrollTop - this.padding.top - ctm.f

    return new Point(x / ctm.a, y / ctm.d)
  }

  localToBackgroundPoint(p: Point.PointLike): Point
  localToBackgroundPoint(x: number, y: number): Point
  localToBackgroundPoint(x: number | Point.PointLike, y?: number) {
    const p = typeof x === 'object' ? Point.create(x) : new Point(x, y)
    const ctm = this.graph.matrix()
    const padding = this.padding
    return Dom.transformPoint(p, ctm).translate(padding.left, padding.top)
  }

  resize(width?: number, height?: number) {
    let w = width != null ? width : this.container.clientWidth
    let h = height != null ? height : this.container.clientHeight

    if (typeof w === 'number') {
      w = Math.round(w)
    }
    if (typeof h === 'number') {
      h = Math.round(h)
    }

    this.options.width = w
    this.options.height = h
    this.$container.css({ width: w, height: h })
    this.update()
  }

  getClientSize() {
    return {
      width: this.container.clientWidth,
      height: this.container.clientHeight,
    }
  }

  autoScroll(clientX: number, clientY: number) {
    const buffer = 10
    const container = this.container
    const rect = container.getBoundingClientRect()

    let dx = 0
    let dy = 0
    if (clientX <= rect.left + buffer) {
      dx = -buffer
    }

    if (clientY <= rect.top + buffer) {
      dy = -buffer
    }

    if (clientX >= rect.right - buffer) {
      dx = buffer
    }

    if (clientY >= rect.bottom - buffer) {
      dy = buffer
    }

    if (dx !== 0) {
      container.scrollLeft += dx
    }

    if (dy !== 0) {
      container.scrollTop += dy
    }
  }

  protected addPadding(
    left?: number,
    right?: number,
    top?: number,
    bottom?: number,
  ) {
    let padding = this.getPadding()
    this.padding = {
      left: Math.round(padding.left + (left || 0)),
      top: Math.round(padding.top + (top || 0)),
      bottom: Math.round(padding.bottom + (bottom || 0)),
      right: Math.round(padding.right + (right || 0)),
    }

    padding = this.padding

    this.$content.css({
      width: padding.left + this.graph.options.width + padding.right,
      height: padding.top + this.graph.options.height + padding.bottom,
    })

    const container = this.graph.container
    container.style.left = `${this.padding.left}px`
    container.style.top = `${this.padding.top}px`

    return this
  }

  protected getPadding() {
    const padding = this.options.padding
    if (typeof padding === 'function') {
      return NumberExt.normalizeSides(FunctionExt.call(padding, this))
    }

    return NumberExt.normalizeSides(padding)
  }

  /**
   * Returns the untransformed size and origin of the current viewport.
   */
  getVisibleArea() {
    const ctm = this.graph.matrix()
    const size = this.getClientSize()
    const box = {
      x: this.container.scrollLeft || 0,
      y: this.container.scrollTop || 0,
      width: size.width,
      height: size.height,
    }
    const area = Dom.transformRectangle(box, ctm.inverse())
    area.x -= (this.padding.left || 0) / this.sx
    area.y -= (this.padding.top || 0) / this.sy
    return area
  }

  isCellVisible(cell: Cell, options: { strict?: boolean } = {}) {
    const bbox = cell.getBBox()
    const area = this.getVisibleArea()
    return options.strict
      ? area.containsRect(bbox)
      : area.isIntersectWithRect(bbox)
  }

  isPointVisible(point: Point.PointLike) {
    return this.getVisibleArea().containsPoint(point)
  }

  /**
   * Lock the current viewport by disabling user scrolling.
   */
  lock() {
    this.$container.css('overflow', 'hidden')
    return this
  }

  /**
   * Enable user scrolling if previously locked.
   */
  unlock() {
    this.$container.css('overflow', 'scroll')
    return this
  }

  protected onRemove() {
    this.stopListening()
  }

  @View.dispose()
  dispose() {
    this.$(this.graph.container).insertBefore(this.$container)
    this.remove()
  }
}

export namespace Scroller {
  export interface CommonOptions {
    className?: string
    width?: number
    height?: number
    pageWidth?: number
    pageHeight?: number
    pageVisible?: boolean
    pageBreak?: boolean
    minVisibleWidth?: number
    minVisibleHeight?: number
    background?: false | BackgroundManager.Options
    autoResize?: boolean
    padding?:
      | NumberExt.SideOptions
      | ((this: Scroller) => NumberExt.SideOptions)
    fitTocontentOptions?:
      | TransformManager.FitToContentFullOptions
      | ((
          this: Scroller,
          scroller: Scroller,
        ) => TransformManager.FitToContentFullOptions)
  }

  export interface Options extends CommonOptions {
    graph: Graph
  }

  export interface ScrollOptions {
    animation?: JQuery.EffectsOptions<HTMLElement>
  }

  export interface CenterOptions extends ScrollOptions {
    padding?: NumberExt.SideOptions
  }

  export type PositionContentOptions = TransformManager.GetContentAreaOptions &
    Scroller.CenterOptions

  export type Direction =
    | 'center'
    | 'top'
    | 'top-right'
    | 'top-left'
    | 'right'
    | 'bottom-right'
    | 'bottom'
    | 'bottom-left'
    | 'left'

  export interface TransitionOptions {
    /**
     * The zoom level to reach at the end of the transition.
     */
    scale?: number
    duration?: string
    delay?: string
    timing?: string
    onTransitionEnd?: (this: Scroller, e: TransitionEvent) => void
  }

  export interface TransitionToRectOptions extends TransitionOptions {
    minScale?: number
    maxScale?: number
    scaleGrid?: number
    visibility?: number
    center?: Point.PointLike
  }
}

export namespace Scroller {
  export class Background extends BackgroundManager {
    protected readonly scroller: Scroller

    protected get elem() {
      return this.scroller.background
    }

    constructor(scroller: Scroller) {
      super(scroller.graph)

      this.scroller = scroller
      if (scroller.options.background) {
        this.draw(scroller.options.background)
      }
    }

    protected init() {
      this.graph.on('scale', this.update, this)
      this.graph.on('translate', this.update, this)
    }

    protected updateBackgroundOptions(options?: BackgroundManager.Options) {
      this.scroller.options.background = options
    }
  }
}

namespace Util {
  export const containerClass = 'graph-scroller'
  export const panningClass = `${containerClass}-panning`
  export const pannableClass = `${containerClass}-pannable`
  export const pagedClass = `${containerClass}-paged`
  export const contentClass = `${containerClass}-content`
  export const backgroundClass = `${containerClass}-background`
  export const transitionClassName = 'transition-in-progress'
  export const transitionEventName = 'transitionend.graph-scroller-transition'

  export const defaultOptions: Partial<Scroller.Options> = {
    padding() {
      const size = this.getClientSize()
      const minWidth = Math.max(this.options.minVisibleWidth || 0, 1) || 1
      const minHeight = Math.max(this.options.minVisibleHeight || 0, 1) || 1
      const left = Math.max(size.width - minWidth, 0)
      const top = Math.max(size.height - minHeight, 0)
      return { left, top, right: left, bottom: top }
    },
    minVisibleWidth: 50,
    minVisibleHeight: 50,
    pageVisible: false,
    pageBreak: false,
    autoResize: true,
  }

  export function getOptions(options: Scroller.Options) {
    const merged = ObjectExt.merge({}, defaultOptions, options)
    const graph = options.graph

    if (merged.pageWidth == null) {
      merged.pageWidth = graph.options.width
    }

    if (merged.pageHeight == null) {
      merged.pageHeight = graph.options.height
    }

    return merged
  }
}
