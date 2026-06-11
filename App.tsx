import React, { useMemo, useState } from 'react';
import {
  Image,
  ImageBackground,
  Linking,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  categories,
  generatedAt,
  initialCategoryId,
  menuItems,
  restaurant,
  starterCartItemIds,
  type MenuCategoryId,
  type MenuItem,
  upsellItemIds,
} from './src/data/perchiniDeliveryMenu';

type Screen = 'menu' | 'cart' | 'loyalty' | 'systems';
type ViewMode = 'list' | 'grid';
type OrderMode = 'delivery' | 'pickup';
type Cart = Record<string, number>;

const tabs: Array<{ id: Screen; title: string }> = [
  { id: 'menu', title: 'Меню' },
  { id: 'cart', title: 'Корзина' },
  { id: 'loyalty', title: 'Лояльность' },
  { id: 'systems', title: 'Системы' },
];

const money = (value: number) => `${value.toLocaleString('ru-RU')} ₽`;
const syncedAtLabel = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
}).format(new Date(generatedAt));

function isVisibleNow(item: MenuItem) {
  const hour = new Date().getHours();

  if (item.visibleFrom === undefined || item.visibleTo === undefined) {
    return true;
  }

  return hour >= item.visibleFrom && hour < item.visibleTo;
}

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#090907" />
      <PerchiniApp />
    </SafeAreaProvider>
  );
}

function PerchiniApp() {
  const [screen, setScreen] = useState<Screen>('menu');
  const [category, setCategory] = useState<MenuCategoryId>(initialCategoryId);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<Cart>(() =>
    starterCartItemIds.reduce<Cart>((next, id) => {
      next[id] = 1;
      return next;
    }, {}),
  );
  const [orderMode, setOrderMode] = useState<OrderMode>('delivery');

  const cartCount = Object.values(cart).reduce((sum, qty) => sum + qty, 0);

  const addToCart = (id: string) => {
    setCart(current => ({ ...current, [id]: (current[id] || 0) + 1 }));
  };

  const removeFromCart = (id: string) => {
    setCart(current => {
      const nextQty = (current[id] || 0) - 1;
      const next = { ...current };

      if (nextQty <= 0) {
        delete next[id];
      } else {
        next[id] = nextQty;
      }

      return next;
    });
  };

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return menuItems.filter(item => {
      const matchesCategory = item.category === category;
      const matchesQuery =
        normalizedQuery.length === 0 ||
        `${item.title} ${item.subtitle}`
          .toLowerCase()
          .includes(normalizedQuery);

      return matchesCategory && matchesQuery;
    });
  }, [category, query]);

  const cartItems = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, quantity]) => {
          const item = menuItems.find(entry => entry.id === id);
          return item ? { item, quantity } : null;
        })
        .filter(Boolean) as Array<{ item: MenuItem; quantity: number }>,
    [cart],
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.appShell}>
        <Header />
        <View style={styles.content}>
          {screen === 'menu' && (
            <MenuScreen
              category={category}
              setCategory={setCategory}
              items={filteredItems}
              viewMode={viewMode}
              setViewMode={setViewMode}
              query={query}
              setQuery={setQuery}
              addToCart={addToCart}
              cart={cart}
            />
          )}
          {screen === 'cart' && (
            <CartScreen
              items={cartItems}
              orderMode={orderMode}
              setOrderMode={setOrderMode}
              addToCart={addToCart}
              removeFromCart={removeFromCart}
            />
          )}
          {screen === 'loyalty' && <LoyaltyScreen />}
          {screen === 'systems' && <SystemsScreen />}
        </View>
        <TabBar active={screen} setScreen={setScreen} cartCount={cartCount} />
      </View>
    </SafeAreaView>
  );
}

function Header() {
  return (
    <ImageBackground
      source={require('./assets/perchini-brand/menu-1.jpg')}
      style={styles.header}
      imageStyle={styles.headerImage}
    >
      <View style={styles.headerShade} />
      <View style={styles.headerContent}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.brand}>{restaurant.name}</Text>
            <Text style={styles.address}>
              {restaurant.city}, {restaurant.address}
            </Text>
          </View>
          <View style={styles.statusPill}>
            <Text style={styles.statusText}>Online</Text>
          </View>
        </View>
        <View style={styles.headerGrid}>
          <View style={styles.headerMetric}>
            <Text style={styles.metricLabel}>Доставка</Text>
            <Text style={styles.metricValue}>{restaurant.deliveryEta}</Text>
          </View>
          <View style={styles.headerMetric}>
            <Text style={styles.metricLabel}>Самовывоз</Text>
            <Text style={styles.metricValue}>{restaurant.pickupEta}</Text>
          </View>
          <View style={styles.headerMetric}>
            <Text style={styles.metricLabel}>Телефон</Text>
            <Text style={styles.metricValue}>{restaurant.phone}</Text>
          </View>
        </View>
      </View>
    </ImageBackground>
  );
}

function MenuScreen({
  category,
  setCategory,
  items,
  viewMode,
  setViewMode,
  query,
  setQuery,
  addToCart,
  cart,
}: {
  category: MenuCategoryId;
  setCategory: (category: MenuCategoryId) => void;
  items: MenuItem[];
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  query: string;
  setQuery: (query: string) => void;
  addToCart: (id: string) => void;
  cart: Cart;
}) {
  const activeCategory = categories.find(entry => entry.id === category);

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.screenTitle}>Основное меню</Text>
          <Text style={styles.screenSubtitle}>
            Доставка: {menuItems.length} позиций, {categories.length} категорий
          </Text>
        </View>
        <View style={styles.viewToggle}>
          <Pressable
            onPress={() => setViewMode('list')}
            style={[
              styles.toggleButton,
              viewMode === 'list' && styles.toggleActive,
            ]}
          >
            <Text
              style={[
                styles.toggleText,
                viewMode === 'list' && styles.toggleTextActive,
              ]}
            >
              Список
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setViewMode('grid')}
            style={[
              styles.toggleButton,
              viewMode === 'grid' && styles.toggleActive,
            ]}
          >
            <Text
              style={[
                styles.toggleText,
                viewMode === 'grid' && styles.toggleTextActive,
              ]}
            >
              Сетка
            </Text>
          </Pressable>
        </View>
      </View>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Поиск по меню"
        placeholderTextColor="#7f806f"
        style={styles.searchInput}
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryRow}
      >
        {categories.map(entry => (
          <Pressable
            key={entry.id}
            onPress={() => setCategory(entry.id)}
            style={[
              styles.categoryChip,
              category === entry.id && styles.categoryChipActive,
            ]}
          >
            <Text
              style={[
                styles.categoryText,
                category === entry.id && styles.categoryTextActive,
              ]}
            >
              {entry.title}
            </Text>
            <Text style={styles.categoryPage}>{entry.itemCount} поз.</Text>
          </Pressable>
        ))}
      </ScrollView>

      {activeCategory && (
        <View style={styles.sourceNotice}>
          <Text style={styles.sourceTitle}>{activeCategory.title}</Text>
          <Text style={styles.sourceText}>
            Доставка из ресторана на Ленина, 17. В этой категории{' '}
            {activeCategory.itemCount} позиций.
          </Text>
          <Pressable
            onPress={() => Linking.openURL(restaurant.menuSource)}
            style={styles.sourceButton}
          >
            <Text style={styles.sourceButtonText}>Открыть доставку</Text>
          </Pressable>
        </View>
      )}

      <View
        style={viewMode === 'grid' ? styles.productGrid : styles.productList}
      >
        {items.map(item => (
          <ProductCard
            key={item.id}
            item={item}
            quantity={cart[item.id] || 0}
            addToCart={addToCart}
            compact={viewMode === 'grid'}
          />
        ))}
      </View>
    </ScrollView>
  );
}

function ProductCard({
  item,
  quantity,
  addToCart,
  compact,
}: {
  item: MenuItem;
  quantity: number;
  addToCart: (id: string) => void;
  compact: boolean;
}) {
  const visible = isVisibleNow(item);
  const canOrder = item.available && visible;

  return (
    <View style={[styles.productCard, compact && styles.productCardCompact]}>
      <Image
        source={item.image}
        style={[styles.productImage, compact && styles.productImageCompact]}
      />
      <View style={styles.productBody}>
        <View style={styles.productTitleRow}>
          <Text style={styles.productTitle}>{item.title}</Text>
          {item.badge && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{item.badge}</Text>
            </View>
          )}
        </View>
        {item.subtitle ? (
          <Text style={styles.productSubtitle}>{item.subtitle}</Text>
        ) : null}
        {item.weight ? <Text style={styles.weight}>{item.weight}</Text> : null}
        {!visible && (
          <Text style={styles.unavailableText}>
            Доступно {item.visibleFrom}:00-{item.visibleTo}:00
          </Text>
        )}
        {!item.available && (
          <Text style={styles.unavailableText}>Стоп-лист</Text>
        )}
        <View style={styles.productFooter}>
          <Text style={styles.price}>{money(item.price)}</Text>
          <Pressable
            disabled={!canOrder}
            onPress={() => addToCart(item.id)}
            style={[styles.addButton, !canOrder && styles.addButtonDisabled]}
          >
            <Text style={styles.addButtonText}>
              {quantity > 0 ? `В корзине ${quantity}` : 'Добавить'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function CartScreen({
  items,
  orderMode,
  setOrderMode,
  addToCart,
  removeFromCart,
}: {
  items: Array<{ item: MenuItem; quantity: number }>;
  orderMode: OrderMode;
  setOrderMode: (mode: OrderMode) => void;
  addToCart: (id: string) => void;
  removeFromCart: (id: string) => void;
}) {
  const subtotal = items.reduce(
    (sum, entry) => sum + entry.item.price * entry.quantity,
    0,
  );
  const deliveryFee = orderMode === 'pickup' || subtotal >= 1500 ? 0 : 199;
  const serviceFee = subtotal > 0 ? 39 : 0;
  const total = subtotal + deliveryFee + serviceFee;
  const upsells = menuItems.filter(item => {
    const hasItem = items.some(entry => entry.item.id === item.id);
    return !hasItem && upsellItemIds.includes(item.id);
  });

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.screenTitle}>Быстрый заказ</Text>
          <Text style={styles.screenSubtitle}>
            Оплата онлайн, доставка и допродажи
          </Text>
        </View>
      </View>

      <View style={styles.segmented}>
        <Pressable
          onPress={() => setOrderMode('delivery')}
          style={[
            styles.segment,
            orderMode === 'delivery' && styles.segmentActive,
          ]}
        >
          <Text
            style={[
              styles.segmentText,
              orderMode === 'delivery' && styles.segmentTextActive,
            ]}
          >
            Доставка
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setOrderMode('pickup')}
          style={[
            styles.segment,
            orderMode === 'pickup' && styles.segmentActive,
          ]}
        >
          <Text
            style={[
              styles.segmentText,
              orderMode === 'pickup' && styles.segmentTextActive,
            ]}
          >
            Самовывоз
          </Text>
        </Pressable>
      </View>

      <View style={styles.cartPanel}>
        {items.length === 0 ? (
          <Text style={styles.emptyCart}>Корзина пуста</Text>
        ) : (
          items.map(({ item, quantity }) => (
            <View key={item.id} style={styles.cartRow}>
              <View style={styles.cartInfo}>
                <Text style={styles.cartTitle}>{item.title}</Text>
                <Text style={styles.cartSubtitle}>
                  {money(item.price)} за порцию
                </Text>
              </View>
              <View style={styles.stepper}>
                <Pressable
                  onPress={() => removeFromCart(item.id)}
                  style={styles.stepButton}
                >
                  <Text style={styles.stepText}>-</Text>
                </Pressable>
                <Text style={styles.qtyText}>{quantity}</Text>
                <Pressable
                  onPress={() => addToCart(item.id)}
                  style={styles.stepButton}
                >
                  <Text style={styles.stepText}>+</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </View>

      <View style={styles.summary}>
        <SummaryRow label="Меню" value={money(subtotal)} />
        <SummaryRow label="Сервис" value={money(serviceFee)} />
        <SummaryRow
          label="Доставка"
          value={deliveryFee === 0 ? '0 ₽' : money(deliveryFee)}
        />
        <View style={styles.summaryTotal}>
          <Text style={styles.totalLabel}>Итого</Text>
          <Text style={styles.totalValue}>{money(total)}</Text>
        </View>
        <Pressable style={styles.payButton}>
          <Text style={styles.payButtonText}>Оплатить онлайн</Text>
        </Pressable>
      </View>

      <Text style={styles.blockTitle}>Умные допродажи</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.upsellRow}
      >
        {upsells.map(item => (
          <Pressable
            key={item.id}
            onPress={() => addToCart(item.id)}
            style={styles.upsellCard}
          >
            <Image source={item.image} style={styles.upsellImage} />
            <Text style={styles.upsellTitle}>{item.title}</Text>
            <Text style={styles.upsellPrice}>{money(item.price)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </ScrollView>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function LoyaltyScreen() {
  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.screenTitle}>Лояльность и отзывы</Text>
          <Text style={styles.screenSubtitle}>
            Бонусы, история заказов, возврат гостей
          </Text>
        </View>
      </View>

      <View style={styles.loyaltyHero}>
        <Text style={styles.bonusLabel}>Баланс</Text>
        <Text style={styles.bonusValue}>1 240 бонусов</Text>
        <Text style={styles.bonusHint}>Можно списать до 30% заказа</Text>
      </View>

      <View style={styles.featureGrid}>
        <FeatureCard
          title="Пуши"
          value="3 сценария"
          detail="День рождения, забытая корзина, новое меню"
        />
        <FeatureCard
          title="Отзывы"
          value="4.8"
          detail="Оценка заказа после доставки"
        />
        <FeatureCard
          title="История"
          value="12 заказов"
          detail="Повторить любимый заказ за один тап"
        />
        <FeatureCard
          title="Акции"
          value="2 активны"
          detail="Паста + напиток, десерт за бонусы"
        />
      </View>

      <Text style={styles.blockTitle}>Последние покупки</Text>
      {[
        'Карбонара + Пепперони',
        'Сырный суп + Баноффи пай',
        'Помодоро + Капрезе',
      ].map((entry, index) => (
        <View key={entry} style={styles.historyRow}>
          <Text style={styles.historyTitle}>{entry}</Text>
          <Text style={styles.historyDate}>{index + 1} нед. назад</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function SystemsScreen() {
  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.screenTitle}>Касса и каналы продаж</Text>
          <Text style={styles.screenSubtitle}>
            Синхронизация меню, заказов и стоп-листов
          </Text>
        </View>
      </View>

      <View style={styles.systemStatus}>
        <Text style={styles.systemStatusTitle}>{restaurant.kitchenStatus}</Text>
        <Text style={styles.systemStatusText}>
          Последняя синхронизация доставки: {syncedAtLabel}
        </Text>
      </View>

      <FeatureCard
        title="Кассовое ПО"
        value="Подключено"
        detail="Меню, клиенты, заказы, статусы кухни"
      />
      <FeatureCard
        title="Стоп-листы"
        value="Онлайн"
        detail="Позиции скрываются по наличию и времени"
      />
      <FeatureCard
        title="Сайт"
        value="Продажи"
        detail="SEO, акции, онлайн-оплата без агрегаторов"
      />
      <FeatureCard
        title="VK Mini App"
        value="Готово"
        detail="Заказы во ВКонтакте без установки приложения"
      />
      <FeatureCard
        title="QR-меню"
        value="Активно"
        detail="Цифровой каталог для гостей в зале"
      />
    </ScrollView>
  );
}

function FeatureCard({
  title,
  value,
  detail,
}: {
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <View style={styles.featureCard}>
      <Text style={styles.featureTitle}>{title}</Text>
      <Text style={styles.featureValue}>{value}</Text>
      <Text style={styles.featureDetail}>{detail}</Text>
    </View>
  );
}

function TabBar({
  active,
  setScreen,
  cartCount,
}: {
  active: Screen;
  setScreen: (screen: Screen) => void;
  cartCount: number;
}) {
  return (
    <View style={styles.tabBar}>
      {tabs.map(tab => (
        <Pressable
          key={tab.id}
          onPress={() => setScreen(tab.id)}
          style={[
            styles.tabButton,
            active === tab.id && styles.tabButtonActive,
          ]}
        >
          <Text
            style={[styles.tabText, active === tab.id && styles.tabTextActive]}
          >
            {tab.title}
          </Text>
          {tab.id === 'cart' && cartCount > 0 && (
            <View style={styles.cartBadge}>
              <Text style={styles.cartBadgeText}>{cartCount}</Text>
            </View>
          )}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#090907',
  },
  appShell: {
    flex: 1,
    backgroundColor: '#11110d',
  },
  header: {
    backgroundColor: '#090907',
    minHeight: 178,
    overflow: 'hidden',
  },
  headerImage: {
    opacity: 0.88,
  },
  headerShade: {
    backgroundColor: 'rgba(0,0,0,0.58)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  headerContent: {
    paddingHorizontal: 18,
    paddingBottom: 18,
    paddingTop: 14,
    zIndex: 1,
  },
  headerTop: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  brand: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  address: {
    color: '#f2f2e8',
    fontSize: 13,
    lineHeight: 18,
    maxWidth: 270,
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  statusPill: {
    backgroundColor: '#ff7a01',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  headerGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  headerMetric: {
    backgroundColor: 'rgba(75,85,0,0.92)',
    borderRadius: 4,
    flex: 1,
    padding: 10,
  },
  metricLabel: {
    color: '#e7edc2',
    fontSize: 11,
    fontWeight: '700',
  },
  metricValue: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
    marginTop: 3,
  },
  content: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 14,
    backgroundColor: '#151510',
  },
  sectionHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  screenTitle: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 0,
  },
  screenSubtitle: {
    color: '#c7c7b6',
    fontSize: 13,
    marginTop: 3,
    maxWidth: 260,
  },
  viewToggle: {
    backgroundColor: '#2a2a20',
    borderRadius: 4,
    flexDirection: 'row',
    padding: 3,
  },
  toggleButton: {
    borderRadius: 3,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  toggleActive: {
    backgroundColor: '#ff7a01',
  },
  toggleText: {
    color: '#d7d7cb',
    fontSize: 12,
    fontWeight: '800',
  },
  toggleTextActive: {
    color: '#ffffff',
  },
  searchInput: {
    backgroundColor: '#ffffff',
    borderColor: '#4B5500',
    borderRadius: 4,
    borderWidth: 1,
    color: '#202312',
    fontSize: 15,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  categoryRow: {
    gap: 8,
    paddingBottom: 10,
  },
  categoryChip: {
    backgroundColor: '#4B5500',
    borderColor: '#4B5500',
    borderRadius: 3,
    borderWidth: 1,
    minWidth: 94,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  categoryChipActive: {
    backgroundColor: '#ff7a01',
    borderColor: '#ff7a01',
  },
  categoryText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  categoryTextActive: {
    color: '#ffffff',
  },
  categoryPage: {
    color: '#e7edc2',
    fontSize: 10,
    marginTop: 2,
  },
  sourceNotice: {
    backgroundColor: '#ffffff',
    borderLeftColor: '#ff7a01',
    borderLeftWidth: 5,
    borderRadius: 4,
    marginBottom: 12,
    padding: 12,
  },
  sourceTitle: {
    color: '#252a05',
    fontSize: 15,
    fontWeight: '900',
  },
  sourceText: {
    color: '#5d6044',
    fontSize: 11,
    marginTop: 4,
  },
  sourceButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#4B5500',
    borderRadius: 3,
    marginTop: 10,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  sourceButtonText: {
    color: '#fff7df',
    fontSize: 12,
    fontWeight: '900',
  },
  productList: {
    gap: 12,
    paddingBottom: 18,
  },
  productGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingBottom: 18,
  },
  productCard: {
    backgroundColor: '#ffffff',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#eadfc7',
    overflow: 'hidden',
  },
  productCardCompact: {
    width: '48.5%',
  },
  productImage: {
    backgroundColor: '#e5dcc7',
    height: 178,
    width: '100%',
  },
  productImageCompact: {
    height: 116,
  },
  productBody: {
    padding: 12,
  },
  productTitleRow: {
    gap: 6,
  },
  productTitle: {
    color: '#1f2411',
    fontSize: 17,
    fontWeight: '900',
    lineHeight: 22,
  },
  productSubtitle: {
    color: '#686956',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 5,
  },
  weight: {
    color: '#8c8875',
    fontSize: 11,
    marginTop: 6,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#4B5500',
    borderRadius: 3,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  productFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  price: {
    color: '#202312',
    fontSize: 18,
    fontWeight: '900',
  },
  addButton: {
    backgroundColor: '#ff7a01',
    borderRadius: 3,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  addButtonDisabled: {
    backgroundColor: '#b9b2a0',
  },
  addButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
  unavailableText: {
    color: '#b33426',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 6,
  },
  segmented: {
    backgroundColor: '#2a2a20',
    borderRadius: 4,
    flexDirection: 'row',
    marginBottom: 12,
    padding: 4,
  },
  segment: {
    alignItems: 'center',
    borderRadius: 3,
    flex: 1,
    paddingVertical: 11,
  },
  segmentActive: {
    backgroundColor: '#ff7a01',
  },
  segmentText: {
    color: '#d7d7cb',
    fontSize: 14,
    fontWeight: '900',
  },
  segmentTextActive: {
    color: '#fff7df',
  },
  cartPanel: {
    backgroundColor: '#ffffff',
    borderColor: '#eadfc7',
    borderRadius: 4,
    borderWidth: 1,
    marginBottom: 12,
    padding: 12,
  },
  emptyCart: {
    color: '#6d6c5c',
    fontSize: 14,
  },
  cartRow: {
    alignItems: 'center',
    borderBottomColor: '#eee5d3',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  cartInfo: {
    flex: 1,
    paddingRight: 10,
  },
  cartTitle: {
    color: '#1f2411',
    fontSize: 15,
    fontWeight: '900',
  },
  cartSubtitle: {
    color: '#7c7b68',
    fontSize: 12,
    marginTop: 3,
  },
  stepper: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
  },
  stepButton: {
    alignItems: 'center',
    backgroundColor: '#4B5500',
    borderRadius: 3,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  stepText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
  },
  qtyText: {
    color: '#202312',
    fontSize: 15,
    fontWeight: '900',
    minWidth: 18,
    textAlign: 'center',
  },
  summary: {
    backgroundColor: '#4B5500',
    borderRadius: 4,
    marginBottom: 16,
    padding: 14,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 7,
  },
  summaryLabel: {
    color: '#d9dfb5',
    fontSize: 13,
  },
  summaryValue: {
    color: '#fff7df',
    fontSize: 13,
    fontWeight: '800',
  },
  summaryTotal: {
    borderTopColor: '#5b6630',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 7,
    paddingTop: 12,
  },
  totalLabel: {
    color: '#fff7df',
    fontSize: 18,
    fontWeight: '900',
  },
  totalValue: {
    color: '#fff7df',
    fontSize: 18,
    fontWeight: '900',
  },
  payButton: {
    alignItems: 'center',
    backgroundColor: '#ff7a01',
    borderRadius: 3,
    marginTop: 14,
    paddingVertical: 13,
  },
  payButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
  },
  blockTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 10,
  },
  upsellRow: {
    gap: 10,
    paddingBottom: 20,
  },
  upsellCard: {
    backgroundColor: '#ffffff',
    borderColor: '#eadfc7',
    borderRadius: 4,
    borderWidth: 1,
    overflow: 'hidden',
    width: 150,
  },
  upsellImage: {
    height: 92,
    width: '100%',
  },
  upsellTitle: {
    color: '#202312',
    fontSize: 13,
    fontWeight: '900',
    paddingHorizontal: 10,
    paddingTop: 9,
  },
  upsellPrice: {
    color: '#ff7a01',
    fontSize: 14,
    fontWeight: '900',
    padding: 10,
  },
  loyaltyHero: {
    backgroundColor: '#4B5500',
    borderRadius: 4,
    marginBottom: 12,
    padding: 18,
  },
  bonusLabel: {
    color: '#dce8a6',
    fontSize: 13,
    fontWeight: '800',
  },
  bonusValue: {
    color: '#fff7df',
    fontSize: 30,
    fontWeight: '900',
    marginTop: 4,
  },
  bonusHint: {
    color: '#f3eccf',
    fontSize: 13,
    marginTop: 4,
  },
  featureGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  featureCard: {
    backgroundColor: '#ffffff',
    borderColor: '#eadfc7',
    borderRadius: 4,
    borderWidth: 1,
    marginBottom: 10,
    padding: 13,
    width: '100%',
  },
  featureTitle: {
    color: '#6b6f43',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  featureValue: {
    color: '#202312',
    fontSize: 20,
    fontWeight: '900',
    marginTop: 4,
  },
  featureDetail: {
    color: '#6c6b58',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  historyRow: {
    backgroundColor: '#ffffff',
    borderColor: '#eadfc7',
    borderRadius: 4,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    padding: 13,
  },
  historyTitle: {
    color: '#202312',
    fontSize: 14,
    fontWeight: '800',
  },
  historyDate: {
    color: '#8c8875',
    fontSize: 12,
  },
  systemStatus: {
    backgroundColor: '#4B5500',
    borderRadius: 4,
    marginBottom: 12,
    padding: 14,
  },
  systemStatusTitle: {
    color: '#fff7df',
    fontSize: 18,
    fontWeight: '900',
  },
  systemStatusText: {
    color: '#d9dfb5',
    fontSize: 12,
    marginTop: 5,
  },
  tabBar: {
    backgroundColor: '#ff7a01',
    borderTopColor: '#ff7a01',
    borderTopWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  tabButton: {
    alignItems: 'center',
    borderRadius: 3,
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  tabButtonActive: {
    backgroundColor: '#4B5500',
  },
  tabText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
  tabTextActive: {
    color: '#fff7df',
  },
  cartBadge: {
    alignItems: 'center',
    backgroundColor: '#4B5500',
    borderRadius: 8,
    justifyContent: 'center',
    minWidth: 18,
    paddingHorizontal: 5,
    position: 'absolute',
    right: 8,
    top: 4,
  },
  cartBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '900',
  },
});

export default App;
