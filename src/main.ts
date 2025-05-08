import './style.css'

const API_BASE_URL = 'https://api.where-car.com:8080';
const HUB_API_URL = 'https://hub.where-car.com:8080';

interface LocationData {
  latitude: number;
  longitude: number;
  timestamp: number;
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

class LocationTracker {
  private locations: LocationData[] = [];
  private intervalId: number | null = null;
  private sendIntervalId: number | null = null;
  private statusElement: HTMLElement;
  private locationElement: HTMLElement;
  private countElement: HTMLElement;
  private startButton: HTMLButtonElement;
  private mdnInput: HTMLInputElement;
  private token: string | null = null;
  private startTime: string | null = null;
  private map: naver.maps.Map | null = null;
  private markers: naver.maps.Marker[] = [];
  private path: naver.maps.Polyline | null = null;
  private drawingManager: naver.maps.drawing.DrawingManager | null = null;
  private drawnPath: naver.maps.Polyline | null = null;
  private pathCoordinates: naver.maps.LatLng[] = [];
  private currentPathIndex: number = 0;
  private isDrawingMode: boolean = false;

  constructor() {
    this.statusElement = document.getElementById('status') as HTMLElement;
    this.locationElement = document.getElementById('current-location') as HTMLElement;
    this.countElement = document.getElementById('collected-count') as HTMLElement;
    this.startButton = document.getElementById('startTracking') as HTMLButtonElement;
    this.mdnInput = document.getElementById('mdnInput') as HTMLInputElement;

    this.initializeMap();
    this.countElement.textContent = `Collected: 0/${END_TIME}`;
    this.mdnInput.addEventListener('input', () => this.validateMdn());
    this.startButton.addEventListener('click', () => this.toggleTracking());
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
        if (!this.isDrawingMode) {
          // 그리기 모드 시작
          this.isDrawingMode = true;
          this.pathCoordinates = [];
          this.statusElement.textContent = 'Status: Drawing mode started. Click to draw path. Double click to finish.';
        }

        // 클릭한 위치를 경로에 추가
        const coord = e.coord;
        this.pathCoordinates.push(coord);
        
        // 경로 업데이트
        if (this.path) {
          const path = this.path.getPath();
          path.push(coord);
          this.path.setPath(path);
        }
      });

      // 더블 클릭 이벤트 리스너 추가
      naver.maps.Event.addListener(this.map, 'dblclick', () => {
        if (this.isDrawingMode && this.pathCoordinates.length > 0) {
          this.isDrawingMode = false;
          this.currentPathIndex = 0;
          this.statusElement.textContent = 'Status: Path drawn, ready to start tracking';
        }
      });
    };

    document.head.appendChild(script);
  }

  private validateMdn() {
    const mdn = this.mdnInput.value.trim();
    const isValid = mdn.length > 0;
    this.startButton.disabled = !isValid;
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
      ang: "0",
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
      ang: "0",
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
        cCnt: "60",
        cList: locationsToSend.map((location, index) => ({
          sec: String(index).padStart(2, '0'),
          gcd: "A",
          lat: String(Math.round(location.latitude * 1000000)),
          lon: String(Math.round(location.longitude * 1000000)),
          ang: "0",
          spd: "0",
          sum: "0",
          bat: "120"
        }))
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
        locationData = {
          latitude: currentCoord.y,
          longitude: currentCoord.x,
          timestamp: Date.now()
        };

        // 다음 좌표로 이동
        this.currentPathIndex = (this.currentPathIndex + 1) % this.pathCoordinates.length;
      } else {
        // 실제 GPS 위치 사용
        const position = await this.getCurrentPosition();
        locationData = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          timestamp: Date.now()
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

    // 그린 경로 제거
    if (this.drawnPath) {
      this.drawnPath.setMap(null);
      this.drawnPath = null;
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

  private updateUI(location: LocationData) {
    this.locationElement.textContent = `Current Location: ${location.latitude}, ${location.longitude}`;
    this.countElement.textContent = `Collected: ${this.locations.length}/${END_TIME}`;
    this.updateMap(location);
  }

  private async toggleTracking() {
    if (this.intervalId === null) {
      // Start tracking
      if (!navigator.geolocation && !this.isDrawingMode) {
        this.statusElement.textContent = 'Status: Geolocation is not supported';
        return;
      }

      if (!this.validateMdn()) {
        this.statusElement.textContent = 'Status: Invalid MDN';
        return;
      }

      if (this.isDrawingMode && this.pathCoordinates.length === 0) {
        this.statusElement.textContent = 'Status: Please draw a path first';
        return;
      }

      try {
        this.statusElement.textContent = 'Status: Getting token...';
        console.log('Starting token request...');
        this.token = await this.getToken();
        console.log('Token received successfully');
        
        this.statusElement.textContent = 'Status: Token received, sending car ON log...';
        console.log('Starting car ON request...');
        const position = await this.getCurrentPosition();
        await this.sendCarOnLog(position);
        console.log('Car ON log sent successfully');
        
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
      } catch (error: any) {
        console.error('Error in toggleTracking:', error);
        this.statusElement.textContent = `Status: Failed to start tracking - ${error.message}`;
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
        this.locationElement.textContent = 'Current Location: -';
        this.countElement.textContent = `Collected: 0/${END_TIME}`;
        this.statusElement.textContent = 'Status: Tracking stopped, car OFF log sent';
        this.startButton.textContent = 'Start Tracking';
      } catch (error) {
        console.error('Error stopping tracking:', error);
        this.statusElement.textContent = 'Status: Error sending car OFF log';
      }
    }
  }
}

// Initialize the tracker when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new LocationTracker();
});
