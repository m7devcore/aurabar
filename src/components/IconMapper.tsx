import {
  AppWindow,
  Calculator,
  Code2,
  Folder,
  Globe,
  Sliders,
  Sparkles,
  Terminal
} from 'lucide-react';

interface IconProps {
  name: string;
  color?: string;
  size?: number;
}

export function AppIconGlyph({ name, color, size = 16 }: IconProps) {
  const style = color ? { color } : undefined;
  switch (name) {
    case 'folder':
      return <Folder size={size} style={style} />;
    case 'terminal':
      return <Terminal size={size} style={style} />;
    case 'code':
      return <Code2 size={size} style={style} />;
    case 'globe':
      return <Globe size={size} style={style} />;
    case 'calculator':
      return <Calculator size={size} style={style} />;
    case 'sliders':
      return <Sliders size={size} style={style} />;
    case 'sparkles':
      return <Sparkles size={size} style={style} />;
    default:
      return <AppWindow size={size} style={style} />;
  }
}
