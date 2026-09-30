import type {
  SlideBlock,
  SlideBlockType,
  SlideCard,
  SlideGalleryImage,
  SlideIconListItem,
  SlideQaItem,
  SlideTimelineStep,
} from '../types'

const BLOCK_TYPE_LABELS: Record<SlideBlockType, string> = {
  header: 'ヘッダー',
  banner: '目的バナー',
  bullet_list: '箇条書き',
  card_row: 'カード列',
  highlight: '強調バナー',
  freeform: '自由記述',
  compare: '比較（Before/After）',
  timeline: '手順・タイムライン',
  quote: '引用・強調テキスト',
  table: '表',
  qa: 'Q&A',
  code_snippet: 'コードスニペット',
  image_gallery: '画像ギャラリー',
  icon_list: 'アイコンリスト',
  image_caption: '画像＋キャプション',
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
  'compare',
  'timeline',
  'quote',
  'table',
  'qa',
  'code_snippet',
  'image_gallery',
  'icon_list',
  'image_caption',
  'freeform',
]

export function emptyCard(): SlideCard {
  return { tone: 'rose', icon: '', heading: '', desc: '', stat: '' }
}

export function emptyTimelineStep(): SlideTimelineStep {
  return { label: '', desc: '' }
}

export function emptyQaItem(): SlideQaItem {
  return { question: '', answer: '' }
}

export function emptyIconListItem(): SlideIconListItem {
  return { icon: '', text: '' }
}

export function emptyGalleryImage(): SlideGalleryImage {
  return { attachment_id: null, caption: '' }
}

export function defaultBlockForType(type: SlideBlockType): SlideBlock {
  return {
    type,
    icon: type === 'header' ? '' : undefined,
    title: type === 'header' ? '' : undefined,
    pill: type === 'header' ? '' : undefined,
    text: type === 'banner' || type === 'highlight' || type === 'quote' ? '' : undefined,
    items: type === 'bullet_list' ? ['', ''] : undefined,
    cards: type === 'card_row' ? [emptyCard(), emptyCard()] : undefined,
    stat_label: type === 'highlight' ? '' : undefined,
    stat_value: type === 'highlight' ? '' : undefined,
    content: type === 'freeform' ? '' : undefined,
    before_label: type === 'compare' ? 'Before' : undefined,
    before_items: type === 'compare' ? ['', ''] : undefined,
    after_label: type === 'compare' ? 'After' : undefined,
    after_items: type === 'compare' ? ['', ''] : undefined,
    steps: type === 'timeline' ? [emptyTimelineStep(), emptyTimelineStep()] : undefined,
    source: type === 'quote' ? '' : undefined,
    headers: type === 'table' ? ['', ''] : undefined,
    rows: type === 'table' ? [['', '']] : undefined,
    qa_items: type === 'qa' ? [emptyQaItem()] : undefined,
    code: type === 'code_snippet' ? '' : undefined,
    caption: type === 'code_snippet' || type === 'image_caption' ? '' : undefined,
    images: type === 'image_gallery' ? [emptyGalleryImage(), emptyGalleryImage()] : undefined,
    icon_items: type === 'icon_list' ? [emptyIconListItem(), emptyIconListItem()] : undefined,
    attachment_id: type === 'image_caption' ? null : undefined,
    image_position: type === 'image_caption' ? 'top' : undefined,
  }
}
