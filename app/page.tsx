import { redirect } from "next/navigation"

// El Radar es una sola página estática (public/radar/index.html) que lee de /api/radar/*.
export default function Inicio() {
  redirect("/radar/index.html")
}
