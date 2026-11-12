/**
 * Slots declared by the shell (sidebar/global panel) are absent from the
 * link-dep type packages, so declare them here via the sanctioned SlotMap
 * augmentation. Shapes verified against the live slot tree (0.2.2 host):
 * sidebar.panellist = list/root, main = keyed/root.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'sidebar.panellist': { kind: 'list'; scope: 'root' }
    'main': { kind: 'keyed'; scope: 'root'; keyProps: Record<string, object> }
  }
}
export {}
