import type { ReactNode } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, View, useWindowDimensions, type ListRenderItem, type ScrollViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C } from './kit';

/** Virtualized counterpart to Screen; never nest it in a vertical ScrollView. */
export function ListScreen<T>({ data, header, footer, topBar, fixedFooter, compact=false, renderItem, keyExtractor, refreshControl }: {
  data: readonly T[];
  header: ReactNode;
  footer?: ReactNode;
  topBar?: ReactNode;
  fixedFooter?: ReactNode;
  compact?: boolean;
  renderItem: ListRenderItem<T>;
  keyExtractor: (item: T) => string;
  refreshControl?: ScrollViewProps['refreshControl'];
}) {
  const {fontScale}=useWindowDimensions();
  return <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'left', 'right']}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : fixedFooter ? 'height' : undefined}>
      {topBar&&<View style={{paddingHorizontal:12,flexShrink:0}}>{topBar}</View>}
      <FlatList style={{flex:1,minHeight:0}} extraData={fontScale} data={data} renderItem={renderItem} keyExtractor={keyExtractor}
        ListHeaderComponent={<View style={{ gap: 12, marginBottom: 12 }}>{header}</View>}
        ListFooterComponent={footer ? <View style={{ marginTop: 12 }}>{footer}</View> : null}
        ItemSeparatorComponent={compact?undefined:Separator} refreshControl={refreshControl}
        keyboardShouldPersistTaps="handled" initialNumToRender={10} maxToRenderPerBatch={8}
        windowSize={7} contentContainerStyle={{ padding: 18, paddingHorizontal:18+Math.min(2,Math.max(0,fontScale-1)), paddingBottom: fixedFooter?18:32 }} />
      {fixedFooter&&<SafeAreaView edges={['bottom']} style={{backgroundColor:C.bg,flexShrink:0}}><View style={{paddingHorizontal:18,paddingVertical:8,borderTopWidth:1,borderColor:C.line}}>{fixedFooter}</View></SafeAreaView>}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
function Separator() { return <View style={{ height: 12 }} />; }
