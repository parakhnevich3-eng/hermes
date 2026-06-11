import { writeFile } from 'node:fs/promises';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const API_BASE = 'https://dostavka-perchini.ru/api/v1/';
const DELIVERY_SITE = 'https://dostavka-perchini.ru/';
const CITY_ID = '53af707d-a10b-42bf-80cd-242d18d2d9ea';
const ORGANIZATION_ID = '60aa026e-bee8-477e-bce8-142de629acef';
const RESTAURANT_ADDRESS = 'Пр. Ленина, д. 17';
const RESTAURANT_PHONE = '+7 (3462) 390-039';
const FALLBACK_IMAGE = 'https://perchini.ru/ass8ts/img/menu-1.jpg';

const CATEGORY_META = {
  352: { id: 'hot', priority: 30, title: 'Горячие блюда' },
  353: { id: 'desserts', priority: 60, title: 'Десерты' },
  354: { id: 'drinks', priority: 70, title: 'Напитки' },
  355: { id: 'pasta', priority: 20, title: 'Паста' },
  356: { id: 'pizza', priority: 10, title: 'Пицца' },
  357: { id: 'salads-snacks', priority: 40, title: 'Салаты/закуски' },
  358: { id: 'soups', priority: 50, title: 'Супы' },
  755: { id: 'egg-addons', priority: 90, title: 'К яйцу куриному' },
  756: { id: 'promo-pizza-addons', priority: 95, title: 'К пиццам по акции' },
  758: { id: 'toppings', priority: 100, title: 'Топпинги' },
};

function formData(payload) {
  const form = new FormData();
  for (const [key, value] of Object.entries(payload)) {
    form.append(key, String(value));
  }
  return form;
}

async function postJson(path, payload) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    body: formData(payload),
  });

  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }

  return response.json();
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function categoryId(group) {
  const meta = CATEGORY_META[group.groupId];
  if (meta) {
    return meta.id;
  }

  return `group-${group.groupId}`;
}

function categoryTitle(group) {
  return CATEGORY_META[group.groupId]?.title ?? cleanText(group.name);
}

function categoryPriority(group) {
  return CATEGORY_META[group.groupId]?.priority ?? 500 + Number(group.groupId);
}

function firstImage(...values) {
  for (const value of values.flat()) {
    if (typeof value === 'string' && value.startsWith('http')) {
      return value;
    }
  }

  return FALLBACK_IMAGE;
}

function formatWeight(weight) {
  const numeric = Number(weight);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '';
  }

  if (numeric < 1) {
    return `${Math.round(numeric * 1000)} г`;
  }

  return `${numeric.toLocaleString('ru-RU')} кг`;
}

function itemBadge(item, category) {
  const name = cleanText(item.name).toLowerCase();

  if (category.id === 'toppings' || category.id.endsWith('addons')) {
    return 'добавка';
  }

  if (name.includes('премиум')) {
    return 'premium';
  }

  if (name.includes('перчини')) {
    return 'фирменное';
  }

  return undefined;
}

function selectIds(items, matcher, limit) {
  return items
    .filter(item =>
      matcher(`${item.title} ${item.subtitle}`.toLowerCase(), item),
    )
    .slice(0, limit)
    .map(item => item.id);
}

function tsString(value) {
  return JSON.stringify(value, null, 2)
    .replace(/"image": \{\n      "uri":/g, '"image": {\n      uri:')
    .replace(/"image": \{\n        "uri":/g, '"image": {\n        uri:');
}

function jsString(value) {
  return JSON.stringify(value, null, 2);
}

async function main() {
  const groupsResponse = await postJson(
    'menu/get/groups/of/menu/by/organization/id/',
    { organizationId: ORGANIZATION_ID },
  );

  const rawGroups = groupsResponse.group ?? [];
  const groupProducts = [];

  for (const group of rawGroups) {
    const productsResponse = await postJson('menu/get/product/by/group/id/', {
      groupId: group.groupId,
    });
    const products = productsResponse.product ?? [];

    groupProducts.push({ group, products });
  }

  const categories = groupProducts
    .filter(({ products }) => products.length > 0)
    .sort(
      (left, right) =>
        categoryPriority(left.group) - categoryPriority(right.group),
    )
    .map(({ group, products }) => ({
      id: categoryId(group),
      groupId: group.groupId,
      title: categoryTitle(group),
      source: `${API_BASE}menu/get/product/by/group/id/`,
      imageUrl: firstImage(group.image),
      itemCount: products.length,
    }));

  const categoryByGroupId = new Map(
    categories.map(category => [category.groupId, category]),
  );
  const items = groupProducts
    .flatMap(({ group, products }) => {
      const category = categoryByGroupId.get(group.groupId);

      if (!category) {
        return [];
      }

      return products.map(product => {
        const imageUrl = firstImage(product.imageLinks, category.imageUrl);
        const item = {
          id: product.id,
          category: category.id,
          title: cleanText(product.name),
          subtitle: cleanText(product.description),
          price: Math.round(Number(product.price) || 0),
          weight: formatWeight(product.weight),
          available: true,
          imageUrl,
          image: { uri: imageUrl },
        };
        const badge = itemBadge(item, category);

        return badge ? { ...item, badge } : item;
      });
    })
    .filter(item => item.title && item.price > 0);

  const initialCategoryId =
    categories.find(category => category.id === 'pizza')?.id ??
    categories[0]?.id ??
    'pizza';
  const starterCartItemIds = [
    ...selectIds(
      items,
      text => text.includes('карбонара') && !text.includes('пицца'),
      1,
    ),
    ...selectIds(items, text => text.includes('пепперони'), 1),
  ].slice(0, 2);
  const upsellItemIds = [
    ...selectIds(
      items,
      text => text.includes('баноффи') || text.includes('тирамису'),
      1,
    ),
    ...selectIds(items, text => text.includes('сырный суп'), 1),
    ...selectIds(
      items,
      text => text.includes('лимонад') || text.includes('морс'),
      1,
    ),
  ].slice(0, 3);

  const restaurant = {
    name: 'Перчини',
    city: 'Сургут',
    address: 'Проспект Ленина 17, ТЦ «Рандеву»',
    officialAddress: RESTAURANT_ADDRESS,
    phone: RESTAURANT_PHONE,
    cityId: CITY_ID,
    organizationId: ORGANIZATION_ID,
    menuSource: DELIVERY_SITE,
    deliveryMenuApi: API_BASE,
    deliveryEta: '60 мин',
    pickupEta: '15 мин',
    kitchenStatus: 'Кухня принимает заказы',
  };

  const generatedAt = new Date().toISOString();
  const sourcePages = categories.map(category => category.source);

  const ts = `import type {ImageSourcePropType} from 'react-native';

export type MenuCategoryId = string;

export type MenuCategory = {
  id: MenuCategoryId;
  groupId: number;
  title: string;
  source: string;
  imageUrl: string;
  itemCount: number;
};

export type MenuItem = {
  id: string;
  category: MenuCategoryId;
  title: string;
  subtitle: string;
  price: number;
  weight: string;
  badge?: string;
  available: boolean;
  visibleFrom?: number;
  visibleTo?: number;
  imageUrl: string;
  image: ImageSourcePropType;
};

export const generatedAt = ${JSON.stringify(generatedAt)};

export const restaurant = ${tsString(restaurant)};

export const categories: MenuCategory[] = ${tsString(categories)};

export const menuItems: MenuItem[] = ${tsString(items)};

export const initialCategoryId: MenuCategoryId = ${JSON.stringify(
    initialCategoryId,
  )};

export const starterCartItemIds = ${tsString(starterCartItemIds)};

export const upsellItemIds = ${tsString(upsellItemIds)};

export const sourcePages = ${tsString(sourcePages)};
`;

  const js = `window.perchiniDeliveryData = ${jsString({
    generatedAt,
    restaurant,
    categories,
    items: items.map(({ image, ...item }) => ({ ...item, img: item.imageUrl })),
    initialCategoryId,
    starterCartItemIds,
    upsellItemIds,
  })};
`;

  await writeFile('src/data/perchiniDeliveryMenu.ts', ts, 'utf8');
  await writeFile('preview/delivery-menu-data.js', js, 'utf8');
  await writeFile(
    'delivery-products-all.json',
    jsString({ generatedAt, groupProducts }) + '\n',
    'utf8',
  );

  console.log(
    `Fetched ${items.length} delivery items in ${categories.length} categories from ${DELIVERY_SITE}`,
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
