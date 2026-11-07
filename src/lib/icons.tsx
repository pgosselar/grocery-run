import {
  Apple, Baby, Beef, Cake, Carrot, Coffee, Cookie, Croissant, Egg, Fish, Gift, House, IceCreamCone,
  Leaf, ListTodo, Milk, PartyPopper, PawPrint, Pizza, Salad, Sandwich, ShoppingBasket, ShoppingCart,
  Soup, Store, Tent, Utensils, Wine, type LucideIcon,
} from "lucide-react";

export const LIST_ICONS: Record<string, LucideIcon> = {
  cart: ShoppingCart, basket: ShoppingBasket, store: Store, list: ListTodo, apple: Apple, carrot: Carrot,
  salad: Salad, leaf: Leaf, beef: Beef, fish: Fish, egg: Egg, milk: Milk, croissant: Croissant, cake: Cake,
  cookie: Cookie, icecream: IceCreamCone, pizza: Pizza, sandwich: Sandwich, soup: Soup, utensils: Utensils,
  coffee: Coffee, wine: Wine, baby: Baby, paw: PawPrint, house: House, gift: Gift, party: PartyPopper, tent: Tent,
};

export function ListIcon({ name, className }: { name: string; className?: string }) {
  const Icon = LIST_ICONS[name] ?? ShoppingCart;
  return <Icon className={className} strokeWidth={2.25} />;
}
