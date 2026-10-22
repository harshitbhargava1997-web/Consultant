import "./globals.css";
import "./vc-course.css";
export const metadata = {
 title: "Vision | School Learning Platform",
 description: "School implementation, teacher development and foundational literacy — one secure platform."
};
export default function RootLayout({ children }) {
 return <html lang="en"><body>{children}</body></html>;
}
