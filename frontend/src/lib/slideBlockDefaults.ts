import type { SlideBlock, SlideBlockType, SlideCard } from '../types'

const BLOCK_TYPE_LABELS: Record<SlideBlockType, string> = {
  header: 'ヘッダー',
  banner: '目的バナー',
  bullet_list: '箇条書き',
  card_row: 'カード列',
  highlight: '強調バナー',
  freeform: '自由記述',
}

export function blockTypeLabel(type: SlideBlockType): string {
  return BLOCK_TYPE_LABELS[type] ?? type
}

export const SLIDE_BLOCK_TYPES: SlideBlockType[] = [
  'header',
  'banner',
  'bullet_list',
  'card_row',
  'highlight',
  'freeform',
]

export function emptyCard(): SlideCard {
  return { tone: 'rose', icon: '', heading: '', desc: '', stat: '' }
}

export function defaultBlockForType(type: SlideBlockType): SlideBlock {
  return {
    type,
    icon: type === 'header' ? '' : undefined,
    title: type === 'header' ? '' : undefined,
    pill: type === 'header' ? '' : undefined,
    text: type === 'banner' || type === 'highlight' ? '' : undefined,
    items: type === 'bullet_list' ? ['', ''] : undefined,
    cards: type === 'card_row' ? [emptyCard(), emptyCard()] : undefined,
    stat_label: type === 'highlight' ? '' : undefined,
    stat_value: type === 'highlight' ? '' : undefined,
    content: type === 'freeform' ? '' : undefined,
  }
}
