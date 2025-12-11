// Next.js 빌드 오류 방지를 위해, 사용하지 않는 CSS import를 제거합니다.
// Tailwind CSS는 아래에서 CDN으로 로드합니다.

const TailwindScript = () => (
  <script src="https://cdn.tailwindcss.com"></script>
);

export const metadata = {
  title: '단조 시방서 관리 시스템',
  description: 'AI 기반 시방서 검색 및 관리 시스템',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        {/* Tailwind CSS를 전역으로 로드합니다. */}
        <TailwindScript />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
