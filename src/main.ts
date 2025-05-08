import './style.css'

const API_BASE_URL = 'https://api.where-car.com:8080';
const HUB_API_URL = 'https://hub.where-car.com:8080';

interface LocationData {
  latitude: number;
  longitude: number;
  timestamp: number;
  speed: number | null;  // km/h 단위, 사용 불가능한 경우 null
  bearing?: number;
}

interface TokenRequest {
  mdn: string;
  tid: string;
  mid: string;
  pv: string;
  did: string;
  dFWVer: string;
}

interface CarLogRequest {
  mdn: string;
  tid: string;
  mid: string;
  pv: string;
  did: string;
  onTime?: string;
  offTime?: string;
  gcd: string;
  lat: string;
  lon: string;
  ang: string;
  spd: string;
  sum: string;
}

interface GpsLogInfo {
  sec: string;    // 발생 시간 초(00-59)
  gcd: string;    // GPS 상태 (A: 정상, V: 비정상, 0: 미장착)
  lat: string;    // 위도 (x1000000)
  lon: string;    // 경도 (x1000000)
  ang: string;    // 방향 (0-365)
  spd: string;    // 속도 (0-255 km/h)
  sum: string;    // 누적 주행 거리 (0-9999999 m)
  bat: string;    // 배터리 전압 (0-9999, 실제값 x10)
}

interface GpsLogRequest {
  mdn: string;
  tid: string;
  mid: string;
  pv: string;
  did: string;
  oTime: string;
  cCnt: string;
  cList: GpsLogInfo[];
}

interface TokenResponse {
  rstCd: string;
  rstMsg: string;
  mdn: string | null;
  token?: string;
}

const END_TIME = 60;

// 두 좌표 사이의 방향(각도)를 계산하는 함수
function getBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);

  const bearingRad = Math.atan2(y, x);
  const bearingDeg = Math.round((toDeg(bearingRad) + 360) % 360);

  return bearingDeg; // 단위: 도(degree), 북쪽 기준 시계방향 (0-359)
}

class LocationTracker {
  private locations: LocationData[] = [];
  private intervalId: number | null = null;
  private sendIntervalId: number | null = null;
  private statusElement: HTMLElement;
  private locationElement: HTMLElement;
  private speedElement: HTMLElement;
  private bearingElement: HTMLElement;
  private countElement: HTMLElement;
  private startButton: HTMLButtonElement;
  private mdnInput: HTMLInputElement;
  private _token: string | null = null;
  private startTime: string | null = null;
  private map: naver.maps.Map | null = null;
  private markers: naver.maps.Marker[] = [];
  private path: naver.maps.Polyline | null = null;
  private pathCoordinates: naver.maps.LatLng[] = [];
  private currentPathIndex: number = 0;
  private isDrawingMode: boolean = false;
  private drawingButton: HTMLButtonElement;
  private isProcessing: boolean = false;
  private currentSpeed: number = 0; // 현재 속도를 저장하는 변수
  private isMoving: boolean = true;
  private prevLocation: { lat: number; lng: number; timestamp: number } | null = null;
  private prevCoordinates: { latitude: number, longitude: number } | null = null;
  private currentBearing: number = 0;

  constructor() {
    this.statusElement = document.getElementById('status') as HTMLElement;
    this.locationElement = document.getElementById('current-location') as HTMLElement;
    this.speedElement = document.getElementById('current-speed') as HTMLElement;
    this.bearingElement = document.getElementById('current-bearing') as HTMLElement;
    this.countElement = document.getElementById('collected-count') as HTMLElement;
    this.startButton = document.getElementById('startTracking') as HTMLButtonElement;
    this.mdnInput = document.getElementById('mdnInput') as HTMLInputElement;
    this.drawingButton = document.getElementById('drawingMode') as HTMLButtonElement;

    this.initializeMap();
    this.countElement.textContent = `Collected: 0/${END_TIME}`;
    this.mdnInput.addEventListener('input', () => this.validateMdn());
    this.startButton.addEventListener('click', () => this.toggleTracking());
    this.drawingButton.addEventListener('click', () => this.toggleDrawingMode());
  }

  private resetDrawingMode() {
    this.isDrawingMode = false;
    this.drawingButton.classList.remove('active');
    this.drawingButton.textContent = 'Draw Path';
    this.pathCoordinates = [];
    this.currentSpeed = 0; // 속도 초기화
    
    if (this.path) {
      this.path.setMap(null);
      this.path = null;
    }
    
    // 새 경로 초기화
    if (this.map) {
      this.path = new naver.maps.Polyline({
        path: [],
        strokeColor: '#FF0000',
        strokeWeight: 3,
        strokeOpacity: 0.8,
        map: this.map
      });
    }
  }

  private toggleDrawingMode() {
    // 트래킹 중에는 그리기 모드 토글 불가
    if (this.intervalId !== null) return;
    
    this.isDrawingMode = !this.isDrawingMode;
    
    if (this.isDrawingMode) {
      // 그리기 모드 활성화
      this.drawingButton.classList.add('active');
      this.drawingButton.textContent = 'Cancel';
      this.pathCoordinates = [];
      
      if (this.path) {
        this.path.setMap(null);
        this.path = null;
      }
      
      // 새 경로 생성
      if (this.map) {
        this.path = new naver.maps.Polyline({
          path: [],
          strokeColor: '#FF0000',
          strokeWeight: 3,
          strokeOpacity: 0.8,
          map: this.map
        });
      }
      
      this.statusElement.textContent = 'Status: Drawing mode active. Click on the map to draw path.';
    } else {
      // 그리기 모드 비활성화
      this.resetDrawingMode();
      this.statusElement.textContent = 'Status: Real-time mode active.';
    }
  }

  private async initializeMap() {
    const clientId = import.meta.env.VITE_NAVER_MAP_CLIENT_ID;
    const script = document.createElement('script');
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${clientId}`;
    script.async = true;
    
    script.onload = () => {
      // 지도 초기화
      this.map = new naver.maps.Map('map', {
        center: new naver.maps.LatLng(37.5665, 126.9780),
        zoom: 15
      });

      // 경로 선 초기화
      this.path = new naver.maps.Polyline({
        path: [],
        strokeColor: '#FF0000',
        strokeWeight: 3,
        strokeOpacity: 0.8,
        map: this.map
      });

      // 마우스 클릭 이벤트 리스너 추가
      naver.maps.Event.addListener(this.map, 'click', (e: any) => {
        if (this.isDrawingMode) {
          // 클릭한 위치를 경로에 추가
          const coord = e.coord;
          this.pathCoordinates.push(coord);
          
          // 경로 업데이트
          if (this.path) {
            const path = this.path.getPath();
            path.push(coord);
            this.path.setPath(path);
          }
        }
      });
    };

    document.head.appendChild(script);
  }

  private validateMdn() {
    const mdn = this.mdnInput.value.trim();
    const isValid = mdn.length > 0;
    this.startButton.disabled = !isValid;
    this.drawingButton.disabled = !isValid;
    return isValid;
  }

  private getMdn(): string {
    return this.mdnInput.value.trim();
  }

  private formatDate(date: Date, includeSeconds: boolean = false): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    return includeSeconds 
      ? `${year}${month}${day}${hours}${minutes}${seconds}`
      : `${year}${month}${day}${hours}${minutes}`;
  }

  private getStoredToken(): string | null {
    return localStorage.getItem('token');
  }

  private setStoredToken(token: string) {
    localStorage.setItem('token', token);
  }

  private clearStoredToken() {
    localStorage.removeItem('token');
  }

  private async getToken(): Promise<string> {
    const storedToken = this.getStoredToken();
    if (storedToken) {
      console.log('Using stored token');
      return storedToken;
    }

    console.log('No stored token, requesting new token');
    const tokenRequest: TokenRequest = {
      mdn: this.getMdn(),
      tid: "A001",
      mid: "6",
      pv: "5",
      did: "1",
      dFWVer: "1.0.0"
    };

    try {
      console.log('Sending token request:', tokenRequest);
      const response = await fetch(`${API_BASE_URL}/api/emulator/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(tokenRequest),
      });

      const data = await response.json() as TokenResponse;
      console.log('Token Response:', { status: response.status, data });
      
      if (!response.ok || data.rstCd !== '000') {
        throw new Error(`Failed to get token: ${data.rstMsg}`);
      }

      if (data.token) {
        this.setStoredToken(data.token);
        return data.token;
      } else {
        throw new Error('Token not received in response');
      }
    } catch (error) {
      console.error('Error getting token:', error);
      throw error;
    }
  }

  private async validateAndRefreshToken(): Promise<string> {
    try {
      const token = await this.getToken();
      return token;
    } catch (error) {
      console.error('Error validating token:', error);
      this.clearStoredToken();
      throw error;
    }
  }

  private async makeAuthenticatedRequest(url: string, method: string, body: any): Promise<any> {
    try {
      const token = await this.validateAndRefreshToken();
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Token': token
        },
        body: JSON.stringify(body)
      });

      const data = await response.json() as TokenResponse;
      
      if (data.rstCd !== '000') {
        if (['200', '201', '202'].includes(data.rstCd)) {
          // 토큰 관련 에러인 경우 토큰을 삭제하고 재시도
          console.log('Token related error, clearing stored token and retrying');
          this.clearStoredToken();
          return this.makeAuthenticatedRequest(url, method, body);
        }
        throw new Error(data.rstMsg);
      }

      return data;
    } catch (error) {
      console.error('Error in authenticated request:', error);
      throw error;
    }
  }

  private async sendCarOnLog(position: GeolocationPosition): Promise<void> {
    const now = new Date();
    this.startTime = this.formatDate(now, true);

    // 초기 방향은 0으로 설정
    this.currentBearing = 0;

    const request: CarLogRequest = {
      mdn: this.getMdn(),
      tid: "A001",
      mid: "6",
      pv: "5",
      did: "1",
      onTime: this.startTime,
      gcd: "A",
      lat: String(Math.round(position.coords.latitude * 1000000)),
      lon: String(Math.round(position.coords.longitude * 1000000)),
      ang: String(this.currentBearing),
      spd: "0",
      sum: "0"
    };

    try {
      console.log('Sending car ON request:', request);
      await this.makeAuthenticatedRequest(`${HUB_API_URL}/api/hub/on`, 'POST', request);
      console.log('Car ON log sent successfully');
    } catch (error) {
      console.error('Error sending car ON log:', error);
      throw error;
    }
  }

  private async sendCarOffLog(position: GeolocationPosition): Promise<void> {
    const request: CarLogRequest = {
      mdn: this.getMdn(),
      tid: "A001",
      mid: "6",
      pv: "5",
      did: "1",
      onTime: this.startTime!,
      offTime: this.formatDate(new Date(), true),
      gcd: "A",
      lat: String(Math.round(position.coords.latitude * 1000000)),
      lon: String(Math.round(position.coords.longitude * 1000000)),
      ang: String(this.currentBearing),
      spd: "0",
      sum: "0"
    };

    try {
      await this.makeAuthenticatedRequest(`${HUB_API_URL}/api/hub/off`, 'POST', request);
      console.log('Car OFF log sent successfully');
    } catch (error) {
      console.error('Error sending car OFF log:', error);
      throw error;
    }
  }

  private async sendLocations() {
    if (this.locations.length === 0) {
      console.log('No locations to send');
      return;
    }

    this.statusElement.textContent = 'Status: Sending locations...';
    
    try {
      const now = new Date();
      const locationsToSend = [...this.locations];
      this.locations = [];

      const gpsLogRequest: GpsLogRequest = {
        mdn: this.getMdn(),
        tid: "A001",
        mid: "6",
        pv: "5",
        did: "1",
        oTime: this.formatDate(now, false),
        cCnt: String(locationsToSend.length),
        cList: locationsToSend.map((location, index) => {
          // 속도 처리: null이면 0, 음수면 0, 255를 초과하면 255로 제한
          let speed = location.speed !== null ? Math.round(location.speed) : 0;
          speed = Math.max(0, Math.min(255, speed)); // 0~255 범위로 제한
          
          return {
            sec: String(index).padStart(2, '0'),
            gcd: "A",
            lat: String(Math.round(location.latitude * 1000000)),
            lon: String(Math.round(location.longitude * 1000000)),
            ang: String(location.bearing || 0),
            spd: String(speed),
            sum: "0",
            bat: "120"
          };
        })
      };

      console.log('Sending GPS log request:', gpsLogRequest);
      await this.makeAuthenticatedRequest(`${HUB_API_URL}/api/hub/gps`, 'POST', gpsLogRequest);
      console.log('GPS log sent successfully');
      this.statusElement.textContent = 'Status: Locations sent successfully';
    } catch (error) {
      console.error('Error sending locations:', error);
      this.statusElement.textContent = 'Status: Error sending locations';
    }
  }

  private async getCurrentPosition(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject);
    });
  }

  private async collectLocation() {
    try {
      let locationData: LocationData;

      if (this.isDrawingMode && this.pathCoordinates.length > 0) {
        // 그린 경로를 따라 위치 데이터 생성
        const currentCoord = this.pathCoordinates[this.currentPathIndex];
        
        // 처음 시작할 때만 초기 속도를 설정 (40~120km/h 범위)
        if (this.currentSpeed === 0) {
          this.currentSpeed = Math.floor(Math.random() * 80) + 40;
        }
        
        // 속도를 -5 ~ +5 범위에서 변화시킴
        const speedChange = Math.floor(Math.random() * 11) - 5;
        this.currentSpeed += speedChange;
        
        // 속도를 0~255 범위 내로 제한
        this.currentSpeed = Math.max(0, Math.min(255, this.currentSpeed));
        
        // 방향 계산 - 그리기 모드에서는 현재 좌표와 다음 좌표의 방향을 계산
        let bearing = 0;
        if (this.currentPathIndex < this.pathCoordinates.length - 1) {
          // 현재 위치와 다음 위치 사이의 방향 계산
          const nextCoord = this.pathCoordinates[this.currentPathIndex + 1];
          bearing = getBearing(
            currentCoord.y, currentCoord.x,
            nextCoord.y, nextCoord.x
          );
        } else if (this.prevCoordinates) {
          // 마지막 좌표에서는 이전 좌표에서의 방향 유지
          bearing = getBearing(
            this.prevCoordinates.latitude, this.prevCoordinates.longitude,
            currentCoord.y, currentCoord.x
          );
        }
        this.currentBearing = bearing;
        
        this.prevCoordinates = {
          latitude: currentCoord.y,
          longitude: currentCoord.x
        };
        
        locationData = {
          latitude: currentCoord.y,
          longitude: currentCoord.x,
          timestamp: Date.now(),
          speed: this.currentSpeed,
          bearing: bearing
        };

        // 다음 좌표로 이동
        this.currentPathIndex += 1;
        
        // 경로의 끝에 도달한 경우 인터벌 중지
        if (this.currentPathIndex >= this.pathCoordinates.length) {
          if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
          }
          this.isMoving = false;
          this.statusElement.textContent = 'Status: End of path reached. Tracking stopped.';
          this.startButton.textContent = 'Start Tracking';
          return;
        }
      } else {
        // 실제 GPS 위치 사용
        const position = await this.getCurrentPosition();
        
        // 현재 위치 저장
        const currentLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          timestamp: Date.now()
        };
        
        // 속도 계산 (iOS 호환성을 위해)
        let calculatedSpeed = 0; // 기본값
        let bearing = this.currentBearing;
        
        if (this.prevLocation) {
          // 두 지점 사이의 거리 계산 (미터 단위)
          const lat1 = this.prevLocation.lat;
          const lon1 = this.prevLocation.lng;
          const lat2 = currentLocation.lat; 
          const lon2 = currentLocation.lng;
          
          const R = 6371e3; // 지구 반지름 (미터)
          const φ1 = lat1 * Math.PI / 180;
          const φ2 = lat2 * Math.PI / 180;
          const Δφ = (lat2 - lat1) * Math.PI / 180;
          const Δλ = (lon2 - lon1) * Math.PI / 180;

          const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ/2) * Math.sin(Δλ/2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          const distance = R * c; // 미터 단위 거리
          
          // 시간 차이 계산 (초 단위)
          const dt = (currentLocation.timestamp - this.prevLocation.timestamp) / 1000;
          
          if (dt > 0) {
            // 속도 계산 (m/s)
            const speedMps = distance / dt;
            // m/s에서 km/h로 변환 (곱하기 3.6)
            calculatedSpeed = speedMps * 3.6;
          }
          
          // 방향 계산 - 이전 위치와 현재 위치 사이의 방향
          if (distance > 1) { // 1m 이상 이동한 경우에만 방향 업데이트
            bearing = getBearing(lat1, lon1, lat2, lon2);
            this.currentBearing = bearing;
          }
        }
        
        if (this.prevCoordinates === null) {
          this.prevCoordinates = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          };
        } else {
          this.prevCoordinates = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          };
        }
        
        // 항상 직접 계산한 속도 사용 (coords.speed 사용 안 함)
        const finalSpeed = calculatedSpeed;
        
        // 이전 위치 업데이트
        this.prevLocation = currentLocation;
        
        locationData = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          timestamp: Date.now(),
          speed: finalSpeed,
          bearing: bearing
        };
      }

      this.locations.push(locationData);
      this.updateUI(locationData);
    } catch (error) {
      console.error('Error getting location:', error);
      this.statusElement.textContent = 'Status: Error getting location';
    }
  }

  private updateMap(location: LocationData) {
    if (!this.map || !this.path) return;

    const position = new naver.maps.LatLng(location.latitude, location.longitude);
    
    // 이전 마커 제거
    this.markers.forEach(marker => marker.setMap(null));
    this.markers = [];

    // 현재 위치에만 마커 추가
    const marker = new naver.maps.Marker({
      position: position,
      map: this.map,
      title: new Date(location.timestamp).toLocaleTimeString()
    });
    this.markers.push(marker);

    // 경로 업데이트
    const path = this.path.getPath();
    path.push(position);
    this.path.setPath(path);

    // 지도 중심 이동
    this.map.setCenter(position);
  }

  private clearMap() {
    if (!this.map) return;

    // 마커 제거
    this.markers.forEach(marker => marker.setMap(null));
    this.markers = [];

    // 경로 제거
    if (this.path) {
      this.path.setMap(null);
      this.path = null;
    }

    this.pathCoordinates = [];
    this.currentPathIndex = 0;
    this.isDrawingMode = false;

    // 새로운 경로 생성
    this.path = new naver.maps.Polyline({
      path: [],
      strokeColor: '#FF0000',
      strokeWeight: 3,
      strokeOpacity: 0.8,
      map: this.map
    });
  }

  private updateUI(locationData: LocationData) {
    // 위치 정보 표시
    this.locationElement.textContent = `Current Location: ${locationData.latitude.toFixed(6)}, ${locationData.longitude.toFixed(6)}`;
    
    // 속도 정보 표시
    const speedValue = locationData.speed !== null ? locationData.speed : 0;
    this.speedElement.textContent = `Current Speed: ${speedValue.toFixed(2)} km/h`;
    
    // 방향 정보 표시
    const bearing = locationData.bearing !== undefined ? locationData.bearing : 0;
    this.bearingElement.textContent = `Current Bearing: ${bearing}° (${this.getBearingDirection(bearing)})`;
    
    // 수집된 위치 데이터 수 업데이트
    this.countElement.textContent = `Collected: ${this.locations.length}/${END_TIME}`;

    // 지도 업데이트
    this.updateMap(locationData);
  }

  // 방향 각도를 방위(N, NE, E 등)로 변환하는 헬퍼 함수
  private getBearingDirection(bearing: number): string {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'];
    return directions[Math.round(bearing / 45) % 8];
  }

  private async toggleTracking() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    
    // 버튼 비활성화 및 시각적 피드백
    this.startButton.disabled = true;

    if (this.intervalId === null) {
      // Start tracking
      if (!navigator.geolocation && !this.isDrawingMode) {
        this.statusElement.textContent = 'Status: Geolocation is not supported';
        this.isProcessing = false;
        this.startButton.disabled = false;
        return;
      }

      if (!this.validateMdn()) {
        this.statusElement.textContent = 'Status: Invalid MDN';
        this.isProcessing = false;
        this.startButton.disabled = false;
        return;
      }

      if (this.isDrawingMode && this.pathCoordinates.length === 0) {
        this.statusElement.textContent = 'Status: Please draw a path first';
        this.isProcessing = false;
        this.startButton.disabled = false;
        return;
      }

      try {
        // 그리기 버튼 비활성화
        this.drawingButton.disabled = true;
        
        // 속도 및 방향 초기화
        this.currentSpeed = 0;
        this.currentBearing = 0;
        this.prevLocation = null;
        this.prevCoordinates = null;
        
        this.statusElement.textContent = 'Status: Getting token...';
        this._token = await this.getToken();
        
        this.statusElement.textContent = 'Status: Token received, sending car ON log...';
        const position = await this.getCurrentPosition();
        await this.sendCarOnLog(position);
        
        this.statusElement.textContent = 'Status: Car ON log sent, starting tracking...';
        
        // Collect location every second
        this.intervalId = setInterval(() => this.collectLocation(), 1000);
        
        // Send collected locations every minute (60초마다)
        this.sendIntervalId = setInterval(async () => {
          if (this.locations.length >= END_TIME) {
            await this.sendLocations();
          }
        }, 1000);
        
        this.startButton.textContent = 'Stop Tracking';
        this.startButton.disabled = false;
      } catch (error: any) {
        console.error('Error in toggleTracking:', error);
        this.statusElement.textContent = `Status: Failed to start tracking - ${error.message}`;
        // 그리기 버튼 다시 활성화
        this.drawingButton.disabled = false;
        this.startButton.disabled = false;
      } finally {
        this.isProcessing = false;
      }
    } else {
      // Stop tracking
      try {
        const position = await this.getCurrentPosition();
        await this.sendCarOffLog(position);
        
        if (this.intervalId !== null) clearInterval(this.intervalId);
        if (this.sendIntervalId !== null) clearInterval(this.sendIntervalId);
        this.intervalId = null;
        this.sendIntervalId = null;
        
        // 현재까지 쌓인 위치 데이터 전송
        if (this.locations.length > 0) {
          await this.sendLocations();
        }
        
        // 완전한 초기화
        this.clearMap();
        this.locations = [];
        this.currentSpeed = 0;
        this.currentBearing = 0;
        this.prevLocation = null;
        this.prevCoordinates = null;
        this.locationElement.textContent = 'Current Location: -';
        this.speedElement.textContent = 'Current Speed: 0.00 km/h';
        this.bearingElement.textContent = 'Current Bearing: N/A';
        this.countElement.textContent = `Collected: 0/${END_TIME}`;
        this.statusElement.textContent = 'Status: Tracking stopped, car OFF log sent';
        this.startButton.textContent = 'Start Tracking';
        
        // 그리기 버튼 초기화 및 활성화
        this.drawingButton.disabled = false;
        this.resetDrawingMode();
        this.startButton.disabled = false;
      } catch (error) {
        console.error('Error stopping tracking:', error);
        this.statusElement.textContent = 'Status: Error sending car OFF log';
        this.startButton.disabled = false;
      } finally {
        this.isProcessing = false;
      }
    }
  }
}

// Initialize the tracker when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new LocationTracker();
});
