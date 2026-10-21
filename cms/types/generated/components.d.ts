import type { Schema, Struct } from '@strapi/strapi';

export interface BlocksBullet extends Struct.ComponentSchema {
  collectionName: 'components_blocks_bullets';
  info: {
    displayName: 'Bullet';
    icon: 'bulletList';
  };
  attributes: {
    text: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface BlocksFeature extends Struct.ComponentSchema {
  collectionName: 'components_blocks_features';
  info: {
    displayName: 'Feature';
    icon: 'star';
  };
  attributes: {
    body: Schema.Attribute.Text;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    visual: Schema.Attribute.Component<'media.visual', false>;
  };
}

export interface BlocksStat extends Struct.ComponentSchema {
  collectionName: 'components_blocks_stats';
  info: {
    displayName: 'Stat';
    icon: 'chartBubble';
  };
  attributes: {
    label: Schema.Attribute.String & Schema.Attribute.Required;
    value: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface MediaGalleryItem extends Struct.ComponentSchema {
  collectionName: 'components_media_gallery_items';
  info: {
    displayName: 'Gallery item';
    icon: 'apps';
  };
  attributes: {
    caption: Schema.Attribute.Text;
    image: Schema.Attribute.Component<'media.image', false>;
    kind: Schema.Attribute.Enumeration<['image', 'loop']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'image'>;
    title: Schema.Attribute.String;
    video: Schema.Attribute.Component<'media.video', false>;
  };
}

export interface MediaImage extends Struct.ComponentSchema {
  collectionName: 'components_media_images';
  info: {
    displayName: 'Image';
    icon: 'picture';
  };
  attributes: {
    alt: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 250;
      }>;
    caption: Schema.Attribute.Text;
    credit: Schema.Attribute.String;
    decorative: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    file: Schema.Attribute.Media<'images'> & Schema.Attribute.Required;
    focalX: Schema.Attribute.Decimal &
      Schema.Attribute.SetMinMax<
        {
          max: 1;
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0.5>;
    focalY: Schema.Attribute.Decimal &
      Schema.Attribute.SetMinMax<
        {
          max: 1;
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0.5>;
  };
}

export interface MediaVideo extends Struct.ComponentSchema {
  collectionName: 'components_media_videos';
  info: {
    displayName: 'Video';
    icon: 'play';
  };
  attributes: {
    caption: Schema.Attribute.Text;
    durationSec: Schema.Attribute.Decimal;
    loop: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    mp4: Schema.Attribute.Media<'videos'> & Schema.Attribute.Required;
    poster: Schema.Attribute.Media<'images'> & Schema.Attribute.Required;
    webm: Schema.Attribute.Media<'videos'>;
  };
}

export interface MediaVisual extends Struct.ComponentSchema {
  collectionName: 'components_media_visuals';
  info: {
    displayName: 'Visual';
    icon: 'landscape';
  };
  attributes: {
    image: Schema.Attribute.Component<'media.image', false>;
    kind: Schema.Attribute.Enumeration<['image', 'video']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'image'>;
    video: Schema.Attribute.Component<'media.video', false>;
  };
}

export interface NavFooterColumn extends Struct.ComponentSchema {
  collectionName: 'components_nav_footer_columns';
  info: {
    displayName: 'Footer column';
    icon: 'layout';
  };
  attributes: {
    links: Schema.Attribute.Component<'shared.link', true>;
    title: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface SectionsCallout extends Struct.ComponentSchema {
  collectionName: 'components_sections_callouts';
  info: {
    displayName: 'Callout';
    icon: 'information';
  };
  attributes: {
    body: Schema.Attribute.Blocks;
    title: Schema.Attribute.String;
    tone: Schema.Attribute.Enumeration<['note', 'tip', 'caution']> &
      Schema.Attribute.DefaultTo<'note'>;
  };
}

export interface SectionsCode extends Struct.ComponentSchema {
  collectionName: 'components_sections_codes';
  info: {
    displayName: 'Code';
    icon: 'code';
  };
  attributes: {
    caption: Schema.Attribute.Text;
    code: Schema.Attribute.Text & Schema.Attribute.Required;
    filename: Schema.Attribute.String;
    language: Schema.Attribute.Enumeration<
      ['python', 'csharp', 'json', 'xml', 'bash', 'ts', 'text']
    > &
      Schema.Attribute.DefaultTo<'text'>;
  };
}

export interface SectionsCompare extends Struct.ComponentSchema {
  collectionName: 'components_sections_compares';
  info: {
    displayName: 'Before / after';
    icon: 'layer';
  };
  attributes: {
    after: Schema.Attribute.Component<'media.image', false>;
    afterLabel: Schema.Attribute.String & Schema.Attribute.DefaultTo<'After'>;
    before: Schema.Attribute.Component<'media.image', false>;
    beforeLabel: Schema.Attribute.String & Schema.Attribute.DefaultTo<'Before'>;
    caption: Schema.Attribute.Text;
  };
}

export interface SectionsGallery extends Struct.ComponentSchema {
  collectionName: 'components_sections_gallerys';
  info: {
    displayName: 'Gallery';
    icon: 'apps';
  };
  attributes: {
    items: Schema.Attribute.Component<'media.gallery-item', true>;
    layout: Schema.Attribute.Enumeration<['grid', 'strip']> &
      Schema.Attribute.DefaultTo<'grid'>;
  };
}

export interface SectionsImage extends Struct.ComponentSchema {
  collectionName: 'components_sections_images';
  info: {
    displayName: 'Image';
    icon: 'picture';
  };
  attributes: {
    image: Schema.Attribute.Component<'media.image', false>;
    size: Schema.Attribute.Enumeration<['inline', 'wide', 'full']> &
      Schema.Attribute.DefaultTo<'wide'>;
  };
}

export interface SectionsLoopVideo extends Struct.ComponentSchema {
  collectionName: 'components_sections_loop_videos';
  info: {
    displayName: 'Loop video';
    icon: 'play';
  };
  attributes: {
    size: Schema.Attribute.Enumeration<['inline', 'wide', 'full']> &
      Schema.Attribute.DefaultTo<'wide'>;
    video: Schema.Attribute.Component<'media.video', false>;
  };
}

export interface SectionsModCard extends Struct.ComponentSchema {
  collectionName: 'components_sections_mod_cards';
  info: {
    displayName: 'Mod card';
    icon: 'puzzle';
  };
  attributes: {
    mod: Schema.Attribute.Relation<'oneToOne', 'api::mod.mod'>;
  };
}

export interface SectionsModelEmbed extends Struct.ComponentSchema {
  collectionName: 'components_sections_model_embeds';
  info: {
    displayName: '3D model';
    icon: 'cube';
  };
  attributes: {
    caption: Schema.Attribute.String;
    model: Schema.Attribute.Relation<
      'oneToOne',
      'api::block-3d-model.block-3d-model'
    >;
  };
}

export interface SectionsQuote extends Struct.ComponentSchema {
  collectionName: 'components_sections_quotes';
  info: {
    displayName: 'Quote';
    icon: 'quote';
  };
  attributes: {
    attribution: Schema.Attribute.String;
    text: Schema.Attribute.Text & Schema.Attribute.Required;
  };
}

export interface SectionsRichText extends Struct.ComponentSchema {
  collectionName: 'components_sections_rich_texts';
  info: {
    displayName: 'Rich text';
    icon: 'feather';
  };
  attributes: {
    content: Schema.Attribute.Blocks & Schema.Attribute.Required;
  };
}

export interface SectionsStatGrid extends Struct.ComponentSchema {
  collectionName: 'components_sections_stat_grids';
  info: {
    displayName: 'Stat grid';
    icon: 'grid';
  };
  attributes: {
    stats: Schema.Attribute.Component<'blocks.stat', true>;
  };
}

export interface SectionsTimelineEmbed extends Struct.ComponentSchema {
  collectionName: 'components_sections_timeline_embeds';
  info: {
    displayName: 'Timeline embed';
    icon: 'clock';
  };
  attributes: {
    family: Schema.Attribute.Relation<
      'oneToOne',
      'api::timeline-family.timeline-family'
    >;
    fromStage: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 1;
        },
        number
      >;
    toStage: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 1;
        },
        number
      >;
  };
}

export interface SharedDownload extends Struct.ComponentSchema {
  collectionName: 'components_shared_downloads';
  info: {
    displayName: 'Download';
    icon: 'download';
  };
  attributes: {
    file: Schema.Attribute.Media<'images' | 'files'>;
    format: Schema.Attribute.String;
    label: Schema.Attribute.String & Schema.Attribute.Required;
    note: Schema.Attribute.String;
  };
}

export interface SharedLink extends Struct.ComponentSchema {
  collectionName: 'components_shared_links';
  info: {
    displayName: 'Link';
    icon: 'link';
  };
  attributes: {
    kind: Schema.Attribute.Enumeration<
      ['internal', 'external', 'steam', 'modio', 'github', 'rss']
    > &
      Schema.Attribute.DefaultTo<'internal'>;
    label: Schema.Attribute.String & Schema.Attribute.Required;
    newTab: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    url: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface SharedSeo extends Struct.ComponentSchema {
  collectionName: 'components_shared_seos';
  info: {
    displayName: 'SEO';
    icon: 'search';
  };
  attributes: {
    canonicalOverride: Schema.Attribute.String;
    metaDescription: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    metaTitle: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 60;
      }>;
    noindex: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    ogImage: Schema.Attribute.Component<'media.image', false>;
  };
}

export interface TimelineStage extends Struct.ComponentSchema {
  collectionName: 'components_timeline_stages';
  info: {
    displayName: 'Stage';
    icon: 'clock';
  };
  attributes: {
    date: Schema.Attribute.DateTime & Schema.Attribute.Required;
    image: Schema.Attribute.Component<'media.image', false>;
    label: Schema.Attribute.String & Schema.Attribute.Required;
    note: Schema.Attribute.Text;
    source: Schema.Attribute.String & Schema.Attribute.Private;
    thumb: Schema.Attribute.Component<'media.image', false>;
  };
}

export interface ViewerAnimation extends Struct.ComponentSchema {
  collectionName: 'components_viewer_animations';
  info: {
    displayName: 'Animation';
    icon: 'play';
  };
  attributes: {
    clip: Schema.Attribute.String & Schema.Attribute.Required;
    durationSec: Schema.Attribute.Decimal;
    label: Schema.Attribute.String & Schema.Attribute.Required;
    loop: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
  };
}

export interface ViewerPaint extends Struct.ComponentSchema {
  collectionName: 'components_viewer_paints';
  info: {
    displayName: 'Paint preset';
    icon: 'brush';
  };
  attributes: {
    hex: Schema.Attribute.String & Schema.Attribute.Required;
    label: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

declare module '@strapi/strapi' {
  export namespace Public {
    export interface ComponentSchemas {
      'blocks.bullet': BlocksBullet;
      'blocks.feature': BlocksFeature;
      'blocks.stat': BlocksStat;
      'media.gallery-item': MediaGalleryItem;
      'media.image': MediaImage;
      'media.video': MediaVideo;
      'media.visual': MediaVisual;
      'nav.footer-column': NavFooterColumn;
      'sections.callout': SectionsCallout;
      'sections.code': SectionsCode;
      'sections.compare': SectionsCompare;
      'sections.gallery': SectionsGallery;
      'sections.image': SectionsImage;
      'sections.loop-video': SectionsLoopVideo;
      'sections.mod-card': SectionsModCard;
      'sections.model-embed': SectionsModelEmbed;
      'sections.quote': SectionsQuote;
      'sections.rich-text': SectionsRichText;
      'sections.stat-grid': SectionsStatGrid;
      'sections.timeline-embed': SectionsTimelineEmbed;
      'shared.download': SharedDownload;
      'shared.link': SharedLink;
      'shared.seo': SharedSeo;
      'timeline.stage': TimelineStage;
      'viewer.animation': ViewerAnimation;
      'viewer.paint': ViewerPaint;
    }
  }
}
