// Mini-mapa (Leaflet + OpenStreetMap) com o device marcado usando o pin padrão
// do Leaflet. Requer internet p/ os tiles.
//
// Dois modos:
//  - visualização (sem onPick): mostra o marcador nas coordenadas dadas.
//  - seleção (onPick definido): permite clicar no mapa (ou arrastar o pin) para
//    escolher a localização; chama onPick(lat, lon) a cada mudança.
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
// Assets do marcador padrão — importados p/ o Vite resolver as URLs no bundle
// (sem isto o ícone padrão quebra em builds com bundler).
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";

const DefaultIcon = L.icon({
  iconUrl,
  iconRetinaUrl,
  shadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Centro padrão quando não há coordenadas (Brasil, zoom baixo p/ o usuário navegar).
const DEFAULT_CENTER: [number, number] = [-15.78, -47.93];

export function DeviceMap({
  lat,
  lon,
  label,
  height = 240,
  onPick,
}: {
  lat: number | null;
  lon: number | null;
  label?: string;
  height?: number;
  onPick?: (lat: number, lon: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  // Guardamos onPick num ref para não recriar o mapa quando ele mudar de identidade.
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  // Monta o mapa uma única vez.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const hasCoords = lat != null && lon != null;
    const map = L.map(el, { attributionControl: false, scrollWheelZoom: true })
      .setView(hasCoords ? [lat as number, lon as number] : DEFAULT_CENTER, hasCoords ? 15 : 4);
    mapRef.current = map;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);

    const pickable = !!onPickRef.current;

    function placeMarker(la: number, lo: number) {
      if (markerRef.current) {
        markerRef.current.setLatLng([la, lo]);
        return;
      }
      const m = L.marker([la, lo], { icon: DefaultIcon, draggable: pickable }).addTo(map);
      if (label && !pickable) m.bindPopup(`${label}<br><span style="font-family:monospace">${la.toFixed(5)}, ${lo.toFixed(5)}</span>`);
      if (pickable) m.on("dragend", () => { const p = m.getLatLng(); onPickRef.current?.(p.lat, p.lng); });
      markerRef.current = m;
    }

    if (hasCoords) placeMarker(lat as number, lon as number);

    if (pickable) {
      map.on("click", (e: L.LeafletMouseEvent) => {
        placeMarker(e.latlng.lat, e.latlng.lng);
        onPickRef.current?.(e.latlng.lat, e.latlng.lng);
      });
    }

    // O container costuma montar com tamanho 0 dentro de cards/flex.
    const t = setTimeout(() => map.invalidateSize(), 120);
    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `relative z-0` cria um stacking context próprio: os controles do Leaflet
  // (z-index 1000) ficam presos aqui e não vazam por cima de modais (z-50).
  return <div ref={ref} style={{ height }} className="relative z-0 w-full" />;
}
