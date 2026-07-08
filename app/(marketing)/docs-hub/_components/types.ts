export interface DocLink {
  title: string;
  description: string;
  href: string;
  internal: boolean;
}

export interface DocSection {
  heading: string;
  links: readonly DocLink[];
}
