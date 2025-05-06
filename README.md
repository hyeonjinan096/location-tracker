# Location Tracker

실시간 위치 추적 및 로깅 웹 애플리케이션입니다.

## 기능

- 실시간 위치 추적
- 1초마다 위치 데이터 수집
- 1분마다 서버로 데이터 전송
- 차량 시동 ON/OFF 로그 전송
- MDN(차량 번호) 입력 지원

## 기술 스택

- TypeScript
- Vite
- HTML5 Geolocation API

## 설치 및 실행

```bash
# 의존성 설치
npm install

# 개발 서버 실행
npm run dev
```

## API 엔드포인트

- 토큰 발급: `https://api.where-car.com:8080/api/emulator/token`
- 위치 데이터 전송: `http://ts.where-car.com:8090/api/gps`
- 차량 ON 로그: `http://ts.where-car.com:8090/api/on`
- 차량 OFF 로그: `http://ts.where-car.com:8090/api/off` 