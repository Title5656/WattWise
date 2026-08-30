const categoryImages: Record<string, string> = {
  'air-conditioner': '/products/daikin-ftkd18zv2s.jpg',
  refrigerator: '/products/samsung-rt35cg5544b1sv.png',
  television: '/products/lg-55ut8050psb.jpg',
  'washing-machine': '/products/electrolux-ewf9024d3wb.png',
  fan: '/products/hatari-ht-s16m7.jpg',
  'water-heater': '/products/stiebel-xg45ec.jpg',
  microwave: '/products/toshiba-er-sm20.webp',
  'rice-cooker': '/products/sharp-ks-com18.png',
};

const fallbackImage = '/products/hatari-ht-s16m7.jpg';

export function imageForCategory(slug: string) {
  return categoryImages[slug] ?? fallbackImage;
}
